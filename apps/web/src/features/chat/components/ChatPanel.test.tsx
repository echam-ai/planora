import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { ApiError, type Conversation } from "@/types";
import { ChatPanel } from "./ChatPanel";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  vi.restoreAllMocks();
  toast.success.mockClear();
  toast.error.mockClear();
});

function proposal(status: "pending" | "applied" | "rejected"): Conversation {
  return {
    id: "c1",
    messages: [
      {
        id: "m1",
        role: "assistant",
        text: "I can move this task.",
        createdAt: "2026-09-28T10:00:00Z",
        action: {
          id: "a1",
          kind: "move",
          title: "Move task",
          summary: "Pay rent",
          fields: [{ label: "Status", from: "Todo", to: "Done" }],
          status,
          payload: { taskId: "t1", status: "done" },
        },
      },
    ],
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatPanel onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("ChatPanel", () => {
  it("keeps the submitted text and shows the notice when a send fails", async () => {
    vi.spyOn(api, "getCurrentConversation").mockResolvedValue({ id: "c1", messages: [] });
    vi.spyOn(api, "sendChatMessage").mockRejectedValue(
      new ApiError("AI_UNAVAILABLE", "The assistant is unavailable. Try again.", { status: 503 }),
    );
    renderPanel();
    const input = await screen.findByLabelText("Message the assistant");

    fireEvent.change(input, { target: { value: "What is overdue?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText(/The assistant didn't respond\./)).toBeInTheDocument();
    expect(input).toHaveValue("What is overdue?");
    expect(screen.queryByText("What is overdue?", { selector: "div" })).not.toBeInTheDocument();
  });

  it("clears the input after a successful send", async () => {
    vi.spyOn(api, "getCurrentConversation").mockResolvedValue({ id: "c1", messages: [] });
    vi.spyOn(api, "sendChatMessage").mockResolvedValue({
      id: "c1",
      messages: [
        { id: "m1", role: "user", text: "hi", createdAt: "2026-09-28T10:00:00Z" },
        { id: "m2", role: "assistant", text: "hello", createdAt: "2026-09-28T10:00:01Z" },
      ],
    });
    renderPanel();
    const input = await screen.findByLabelText("Message the assistant");

    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("shows the API's message, not 'Change applied', when confirming a cancelled action", async () => {
    vi.spyOn(api, "getCurrentConversation")
      .mockResolvedValueOnce(proposal("pending"))
      .mockResolvedValue(proposal("rejected"));
    vi.spyOn(api, "confirmChatAction").mockRejectedValue(
      new ApiError("ACTION_ALREADY_REJECTED", "This change was cancelled, so it wasn't applied.", {
        status: 409,
      }),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This change was cancelled, so it wasn't applied."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([
    ["confirm", "Confirm", 409, "ACTION_ALREADY_REJECTED"],
    ["confirm", "Confirm", 404, "NOT_FOUND"],
    ["reject", "Cancel", 409, "ACTION_ALREADY_APPLIED"],
    ["reject", "Cancel", 404, "NOT_FOUND"],
  ] as const)(
    "refetches the conversation when $0 fails with $2",
    async (method, button, status, code) => {
      const read = vi
        .spyOn(api, "getCurrentConversation")
        .mockResolvedValueOnce(proposal("pending"))
        .mockResolvedValue(proposal(status === 404 ? "pending" : "applied"));
      vi.spyOn(
        api,
        method === "confirm" ? "confirmChatAction" : "rejectChatAction",
      ).mockRejectedValue(new ApiError(code, "nope", { status }));
      renderPanel();

      fireEvent.click(await screen.findByRole("button", { name: button }));

      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(toast.error).toHaveBeenCalledWith("nope");
    },
  );

  it("does not refetch when confirm fails for another reason", async () => {
    const read = vi.spyOn(api, "getCurrentConversation").mockResolvedValue(proposal("pending"));
    vi.spyOn(api, "confirmChatAction").mockRejectedValue(
      new ApiError("SIMULATED_FAILURE", "boom", { status: 500 }),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
    expect(read).toHaveBeenCalledTimes(1);
  });
});
