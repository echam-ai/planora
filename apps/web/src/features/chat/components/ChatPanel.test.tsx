import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { qk } from "@/shared/queryKeys";
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
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ChatPanel onClose={() => {}} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

const UNAVAILABLE = "The assistant is unavailable right now. Try again.";
const unavailable = () => new ApiError("AI_UNAVAILABLE", UNAVAILABLE, { status: 503 });

function deferredSend() {
  let resolve!: (c: Conversation) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<Conversation>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const send = vi.spyOn(api, "sendChatMessage").mockReturnValue(promise);
  return { send, resolve, reject };
}

const emptyConversation: Conversation = { id: "c1", messages: [] };
const replied: Conversation = {
  id: "c1",
  messages: [
    { id: "m1", role: "user", text: "hi", createdAt: "2026-09-28T10:00:00Z" },
    { id: "m2", role: "assistant", text: "hello", createdAt: "2026-09-28T10:00:01Z" },
  ],
};

describe("ChatPanel", () => {
  it("keeps the submitted text and shows the notice when a send fails", async () => {
    vi.spyOn(api, "getCurrentConversation").mockResolvedValue({ id: "c1", messages: [] });
    vi.spyOn(api, "sendChatMessage").mockRejectedValue(unavailable());
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
  describe("sending", () => {
    it("sends a clicked suggestion", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      const send = vi.spyOn(api, "sendChatMessage").mockResolvedValue(replied);
      renderPanel();

      fireEvent.click(await screen.findByRole("button", { name: "What is overdue?" }));

      await waitFor(() => expect(send).toHaveBeenCalledWith("What is overdue?"));
    });

    it("sends the trimmed text when Send is pressed", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      const send = vi.spyOn(api, "sendChatMessage").mockResolvedValue(replied);
      renderPanel();

      fireEvent.change(await screen.findByLabelText("Message the assistant"), {
        target: { value: "  hi  " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith("hi");
    });

    it("does not send whitespace-only text", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      const send = vi.spyOn(api, "sendChatMessage").mockResolvedValue(replied);
      renderPanel();
      const input = await screen.findByLabelText("Message the assistant");

      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      fireEvent.keyDown(input, { key: "Enter" });

      expect(send).not.toHaveBeenCalled();
    });

    it("does not send on Shift+Enter and keeps the text", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      const send = vi.spyOn(api, "sendChatMessage").mockResolvedValue(replied);
      renderPanel();
      const input = await screen.findByLabelText("Message the assistant");

      fireEvent.change(input, { target: { value: "line one" } });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

      expect(send).not.toHaveBeenCalled();
      expect(input).toHaveValue("line one");
    });

    it("lets the user dismiss the failed-send notice", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      vi.spyOn(api, "sendChatMessage").mockRejectedValue(new ApiError("AI_UNAVAILABLE", "down"));
      renderPanel();
      const input = await screen.findByLabelText("Message the assistant");
      fireEvent.change(input, { target: { value: "hi" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByText(/The assistant didn't respond\./)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      await waitFor(() =>
        expect(screen.queryByText(/The assistant didn't respond\./)).not.toBeInTheDocument(),
      );
    });
  });

  describe("while a send is pending", () => {
    async function startPending() {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      const d = deferredSend();
      renderPanel();
      const input = await screen.findByLabelText("Message the assistant");
      fireEvent.change(input, { target: { value: "first" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(d.send).toHaveBeenCalledTimes(1));
      return { ...d, input };
    }

    it("ignores Enter, keeps the typed text and keeps it when the send fails", async () => {
      const { send, reject, input } = await startPending();

      fireEvent.change(input, { target: { value: "second" } });
      expect(input).toHaveValue("second");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith("first");
      expect(input).toHaveValue("second");

      reject(unavailable());

      expect(await screen.findByText(/The assistant didn't respond\./)).toBeInTheDocument();
      expect(toast.error).toHaveBeenCalledWith(UNAVAILABLE);
      expect(input).toHaveValue("second");
    });

    it("disables Send and every suggestion, and clicking a suggestion sends nothing", async () => {
      const { send } = await startPending();

      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
      const suggestions = screen.getAllByRole("button", { name: /^(What|Show|Add|Move)/ });
      expect(suggestions).toHaveLength(4);
      for (const s of suggestions) expect(s).toBeDisabled();
      fireEvent.click(await screen.findByRole("button", { name: "What is overdue?" }));

      expect(send).toHaveBeenCalledTimes(1);
    });

    it("restores the text after a failure with no new typing, then Enter retries it", async () => {
      const { send, reject, input } = await startPending();
      expect(input).toHaveValue("");

      reject(unavailable());

      await waitFor(() => expect(input).toHaveValue("first"));
      send.mockResolvedValue(replied);
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      expect(send).toHaveBeenLastCalledWith("first");
    });
  });

  describe("suggestions with a draft typed", () => {
    it("sends the suggestion, leaves the draft alone while pending and after success", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      const { send, resolve } = deferredSend();
      renderPanel();
      const input = await screen.findByLabelText("Message the assistant");
      fireEvent.change(input, { target: { value: "draft" } });

      fireEvent.click(await screen.findByRole("button", { name: "What is overdue?" }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith("What is overdue?");
      expect(input).toHaveValue("draft");
      resolve(replied);
      expect(await screen.findByText("hello")).toBeInTheDocument();
      expect(input).toHaveValue("draft");
    });

    it("keeps the draft when the suggestion send fails", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      vi.spyOn(api, "sendChatMessage").mockRejectedValue(unavailable());
      renderPanel();
      const input = await screen.findByLabelText("Message the assistant");
      fireEvent.change(input, { target: { value: "draft" } });

      fireEvent.click(await screen.findByRole("button", { name: "What is overdue?" }));

      expect(await screen.findByText(/The assistant didn't respond\./)).toBeInTheDocument();
      expect(input).toHaveValue("draft");
    });

    it("puts a failed suggestion's text in an empty input", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(emptyConversation);
      vi.spyOn(api, "sendChatMessage").mockRejectedValue(unavailable());
      renderPanel();
      const input = await screen.findByLabelText("Message the assistant");

      fireEvent.click(await screen.findByRole("button", { name: "What is overdue?" }));

      await waitFor(() => expect(input).toHaveValue("What is overdue?"));
    });
  });

  describe("proposals", () => {
    it("shows the applied state, a toast and refreshes tasks after Confirm succeeds", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(proposal("pending"));
      const confirm = vi.spyOn(api, "confirmChatAction").mockResolvedValue(proposal("applied"));
      const { invalidate } = renderPanel();

      fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

      expect(await screen.findByText("Applied to your board")).toBeInTheDocument();
      expect(confirm).toHaveBeenCalledWith("a1");
      expect(toast.success).toHaveBeenCalledWith("Change applied");
      expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.tasks });
    });

    it("shows the cancelled state without a success toast after Cancel succeeds", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(proposal("pending"));
      const reject = vi.spyOn(api, "rejectChatAction").mockResolvedValue(proposal("rejected"));
      renderPanel();

      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(await screen.findByText("Cancelled")).toBeInTheDocument();
      expect(reject).toHaveBeenCalledWith("a1");
      expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("shows only the new value for a create proposal", async () => {
      const create = proposal("pending");
      const action = create.messages[0]!.action!;
      action.kind = "create";
      action.fields = [{ label: "Title", to: "Buy milk" }];
      vi.spyOn(api, "getCurrentConversation").mockResolvedValueOnce(create);
      renderPanel();
      const createValue = (await screen.findByText("Title")).nextElementSibling;
      expect(createValue?.textContent?.trim()).toBe("Buy milk");
    });

    it("shows the old and the new value for an edit proposal", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(proposal("pending"));
      renderPanel();

      const value = (await screen.findByText("Status")).nextElementSibling as HTMLElement;

      expect(within(value).getByText("Todo")).toBeInTheDocument();
      expect(within(value).getByText("Done")).toBeInTheDocument();
    });
  });

  describe("new conversation", () => {
    it("keeps the chat when the user backs out of the confirmation", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(proposal("pending"));
      const start = vi.spyOn(api, "startNewConversation");
      renderPanel();
      await screen.findByText("I can move this task.");

      fireEvent.click(screen.getByRole("button", { name: "New" }));
      expect(await screen.findByText("Start a new conversation?")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Keep chat" }));

      await waitFor(() =>
        expect(screen.queryByText("Start a new conversation?")).not.toBeInTheDocument(),
      );
      expect(start).not.toHaveBeenCalled();
      expect(screen.getByText("I can move this task.")).toBeInTheDocument();
    });

    it("starts a fresh conversation after confirmation and shows the suggestions again", async () => {
      vi.spyOn(api, "getCurrentConversation").mockResolvedValue(proposal("pending"));
      const start = vi.spyOn(api, "startNewConversation").mockResolvedValue(emptyConversation);
      renderPanel();
      await screen.findByText("I can move this task.");
      expect(screen.queryByRole("button", { name: "What is overdue?" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "New" }));
      fireEvent.click(await screen.findByRole("button", { name: "New conversation" }));

      expect(await screen.findByRole("button", { name: "What is overdue?" })).toBeInTheDocument();
      expect(start).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("I can move this task.")).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^(What|Show|Add|Move)/ })).toHaveLength(4);
    });
  });
});
