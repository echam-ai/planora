import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTaskDialog } from "@/features/tasks/components/CreateTaskDialog";
import { api } from "@/services/api";
import { selectProfile } from "@/services/api/profiles";
import { ApiError, type ParsedTaskText, type Task, type TaskDraft } from "@/types";

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    title: "Ship the release notes",
    content: "Draft and send the release notes",
    category: "work",
    priority: "medium",
    deadlineAt: null,
    urls: [],
    markdownNote: "",
    ...overrides,
  };
}

function makeTask(): Task {
  return {
    id: "t1",
    title: "Ship the release notes",
    content: "Draft and send the release notes",
    status: "todo",
    category: "work",
    priority: "medium",
    deadlineAt: null,
    urls: [],
    markdownNote: "",
    position: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    archivedAt: null,
  };
}

let qc: QueryClient;

function renderDialog(onOpenChange = vi.fn()) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CreateTaskDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange };
}

beforeEach(() => {
  vi.spyOn(api, "getSettings").mockResolvedValue({
    timezone: "UTC",
    modelName: "kimi-k3",
    availableModels: ["kimi-k3"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  qc?.clear();
});

describe("CreateTaskDialog", () => {
  const limitMessage =
    "Quick capture takes up to 4,000 characters. Shorten the text, or continue in the form.";

  it("keeps an over-limit paste, explains the limit, and offers the full form", async () => {
    const parseTaskText = vi.spyOn(api, "parseTaskText");
    renderDialog();
    const note = "a".repeat(4500);
    const textarea = screen.getByLabelText("Describe the task in your own words");
    fireEvent.change(textarea, { target: { value: note } });

    const message = screen.getByText(limitMessage);
    expect(screen.getByText("4,500 / 4,000 characters")).toBeVisible();
    expect(textarea).toHaveValue(note);
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAttribute("aria-describedby", message.id);
    const parseButton = screen.getByRole("button", { name: "Parse task" });
    expect(parseButton).toBeDisabled();
    fireEvent.click(parseButton);
    expect(parseTaskText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue in the form instead" }));
    expect(await screen.findByRole("tab", { name: "Task form", selected: true })).toBeVisible();
    expect(await screen.findByLabelText("Content")).toHaveValue(note);
  });

  it("accepts exactly 4,000 trimmed characters, including surrounding whitespace", async () => {
    const parseTaskText = vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());
    renderDialog();
    const note = `  ${"a".repeat(4000)}\n`;
    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: note },
    });
    expect(screen.queryByText(limitMessage)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await waitFor(() => expect(parseTaskText).toHaveBeenCalledWith(note, expect.any(AbortSignal)));
  });

  it("counts emoji as Unicode code points", () => {
    renderDialog();
    const textarea = screen.getByLabelText("Describe the task in your own words");
    fireEvent.change(textarea, { target: { value: "😀".repeat(4000) } });
    expect(screen.getByRole("button", { name: "Parse task" })).toBeEnabled();
    expect(screen.queryByText(limitMessage)).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "😀".repeat(4001) } });
    expect(screen.getByText(limitMessage)).toBeVisible();
    expect(screen.getByText("4,001 / 4,000 characters")).toBeVisible();
    expect(screen.getByRole("button", { name: "Parse task" })).toBeDisabled();
  });

  it("explains a text validation error from the API and preserves manual entry", async () => {
    vi.spyOn(api, "parseTaskText").mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Request validation failed.", {
        status: 422,
        details: [{ field: "text", code: "VALUE_ERROR", message: "Too long." }],
      }),
    );
    renderDialog();
    const note = "Plan the offsite";
    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: note },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));

    expect(await screen.findByText(limitMessage)).toBeVisible();
    expect(screen.queryByText("Request validation failed.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Describe the task in your own words")).toHaveValue(note);
    fireEvent.click(screen.getByRole("button", { name: "Continue in the form instead" }));
    expect(await screen.findByLabelText("Content")).toHaveValue(note);
  });

  it("parses quick-capture text, then creates the reviewed draft and closes", async () => {
    vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());
    const createTask = vi.spyOn(api, "createTask").mockResolvedValue(makeTask());
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Ship the release notes by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));

    await screen.findByText(/nothing is created until you choose/);
    expect(await screen.findByLabelText("Title")).toHaveValue("Ship the release notes");

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith(draft()));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows a parse error with an escape hatch into the full form", async () => {
    vi.spyOn(api, "parseTaskText").mockRejectedValue(new Error("Couldn't understand that text"));
    renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "gibberish" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));

    expect(await screen.findByText("Couldn't understand that text")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue in the form instead" }));

    expect(await screen.findByRole("tab", { name: "Task form", selected: true })).toBeVisible();
  });

  it("keeps the typed text and the escape hatch when the assistant is unavailable", async () => {
    vi.spyOn(api, "parseTaskText").mockRejectedValue(
      new ApiError("AI_UNAVAILABLE", "The assistant is unavailable right now."),
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Book the dentist for Tuesday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));

    expect(await screen.findByText("The assistant is unavailable right now.")).toBeInTheDocument();
    expect(screen.getByLabelText("Describe the task in your own words")).toHaveValue(
      "Book the dentist for Tuesday",
    );
    expect(screen.getByRole("button", { name: "Continue in the form instead" })).toBeVisible();
  });

  it("returns from the review step back to the quick-capture text", async () => {
    vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());
    renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Ship the release notes by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await screen.findByRole("button", { name: "Back to text" });

    fireEvent.click(screen.getByRole("button", { name: "Back to text" }));

    expect(await screen.findByLabelText("Describe the task in your own words")).toHaveValue(
      "Ship the release notes by Friday",
    );
  });

  it("creates a task from the full form tab, seeded with the quick-capture text as content", async () => {
    const createTask = vi.spyOn(api, "createTask").mockResolvedValue(makeTask());
    renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "loose notes" },
    });
    // Radix Tabs selects a trigger on pointerdown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Task form" }));

    expect(await screen.findByLabelText("Content")).toHaveValue("loose notes");
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Follow up on loose notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Follow up on loose notes", content: "loose notes" }),
      ),
    );
  });

  it("surfaces the create failure as a toast without dismissing the dialog", async () => {
    vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());
    const createTask = vi
      .spyOn(api, "createTask")
      .mockRejectedValue(new Error("Couldn't save that task"));
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Ship the release notes by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await screen.findByRole("button", { name: "Create task" });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closing via Escape reports back through onOpenChange", async () => {
    const { onOpenChange } = renderDialog();

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("cancelling clears the draft, so reopening starts from a blank quick-capture tab", async () => {
    vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());

    function Wrapper() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>reopen</button>
          <CreateTaskDialog open={open} onOpenChange={setOpen} />
        </>
      );
    }
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Wrapper />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Ship the release notes by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Describe the task in your own words")).toHaveValue("");
    });
  });
});

it("quick capture accepts Python whitespace at the API boundary without changing the draft", async () => {
  const parse = vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());
  renderDialog();
  const raw = `\u0085${"a".repeat(4000)}\u001c`;
  const input = screen.getByLabelText("Describe the task in your own words");
  fireEvent.change(input, { target: { value: raw } });
  expect(input).toHaveValue(raw);
  expect(input).not.toHaveAttribute("aria-invalid");
  const button = screen.getByRole("button", { name: "Parse task" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(parse).toHaveBeenCalledWith(raw, expect.any(AbortSignal)));
});

describe("CreateTaskDialog cancellation", () => {
  const NOTE = "Ship the release notes by Friday";
  const noteField = () => screen.getByLabelText("Describe the task in your own words");

  function deferredParse() {
    let resolve!: (d: ParsedTaskText) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<ParsedTaskText>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const parse = vi.spyOn(api, "parseTaskText").mockReturnValue(promise);
    return { parse, resolve, reject };
  }

  async function startParsing(onOpenChange = vi.fn()) {
    const d = deferredParse();
    const utils = renderDialog(onOpenChange);
    fireEvent.change(noteField(), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await screen.findByRole("button", { name: "Stop parsing" });
    const signal = d.parse.mock.calls[0]![1] as AbortSignal;
    return { ...d, ...utils, signal };
  }

  it("swaps Cancel for an enabled Stop parsing beside the disabled progress button", async () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Stop parsing" })).not.toBeInTheDocument();

    deferredParse();
    fireEvent.change(noteField(), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));

    expect(await screen.findByRole("button", { name: "Stop parsing" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reading your note…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("Stop parsing aborts, keeps the dialog open on the editable note and focuses it", async () => {
    const { signal, onOpenChange } = await startParsing();

    fireEvent.click(screen.getByRole("button", { name: "Stop parsing" }));

    expect(signal.aborted).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(noteField()).toHaveValue(NOTE);
    expect(noteField()).toHaveFocus();
    expect(screen.getByRole("button", { name: "Parse task" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Reading your note…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop parsing" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Continue in the form instead/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a result arriving after Stop parsing never opens the review; a new parse shows its own", async () => {
    const { resolve, parse } = await startParsing();
    fireEvent.click(screen.getByRole("button", { name: "Stop parsing" }));

    await act(async () => resolve(draft({ title: "Late result" })));

    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(noteField()).toHaveValue(NOTE);
    expect(screen.getByRole("button", { name: "Parse task" })).toBeEnabled();

    parse.mockResolvedValue(draft({ title: "Fresh result" }));
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    expect(await screen.findByLabelText("Title")).toHaveValue("Fresh result");
  });

  it("an old result cannot end a newer parse's progress state", async () => {
    const { resolve, parse } = await startParsing();
    fireEvent.click(screen.getByRole("button", { name: "Stop parsing" }));
    parse.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await screen.findByRole("button", { name: "Stop parsing" });

    await act(async () => resolve(draft({ title: "Late result" })));

    expect(screen.getByRole("button", { name: "Reading your note…" })).toBeDisabled();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("shows no error when the stopped request rejects", async () => {
    const { reject } = await startParsing();
    fireEvent.click(screen.getByRole("button", { name: "Stop parsing" }));

    await act(async () => reject(new DOMException("Aborted", "AbortError")));

    expect(screen.queryByText(/Continue in the form instead/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aborted/i)).not.toBeInTheDocument();
    expect(noteField()).toHaveValue(NOTE);
  });

  /** Like the real adapters: rejects with an AbortError as soon as the signal aborts. */
  function parseThatHonoursAbort() {
    return vi
      .spyOn(api, "parseTaskText")
      .mockImplementation(
        (_text, signal) =>
          new Promise<ParsedTaskText>((_resolve, reject) =>
            signal?.addEventListener("abort", () => reject(signal.reason)),
          ),
      );
  }

  it("a closing dialog keeps showing its progress until the 200 ms delay, even though the request rejects at once", async () => {
    parseThatHonoursAbort();
    const { onOpenChange } = renderDialog();
    fireEvent.change(noteField(), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await screen.findByRole("button", { name: "Stop parsing" });
    vi.useFakeTimers();
    try {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await act(async () => {
        await Promise.resolve();
      });

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.getByRole("button", { name: "Reading your note…" })).toBeInTheDocument();
      expect(noteField()).toHaveValue(NOTE);
      act(() => vi.advanceTimersByTime(200));
      expect(noteField()).toHaveValue("");
      expect(screen.getByRole("button", { name: "Parse task" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an account change ends the progress state of a dialog that stays mounted", async () => {
    parseThatHonoursAbort();
    renderDialog();
    fireEvent.change(noteField(), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await screen.findByRole("button", { name: "Stop parsing" });

    act(() => selectProfile("ech_princess"));

    expect(await screen.findByRole("button", { name: "Parse task" })).toBeEnabled();
    expect(screen.queryByText(/aborted/i)).not.toBeInTheDocument();
  });

  it("closing aborts the request and keeps the content for the 200 ms close delay, then resets", async () => {
    const { signal, onOpenChange, resolve } = await startParsing();
    vi.useFakeTimers();
    try {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(signal.aborted).toBe(true);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      act(() => vi.advanceTimersByTime(199));
      expect(noteField()).toHaveValue(NOTE);
      expect(screen.getByRole("button", { name: "Reading your note…" })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1));
      expect(noteField()).toHaveValue("");
      expect(screen.getByRole("button", { name: "Parse task" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Reading your note…" })).not.toBeInTheDocument();

      await act(async () => resolve(draft({ title: "Late result" })));
      expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the request when the dialog unmounts", async () => {
    const { signal, unmount } = await startParsing();
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("aborts the request when the account changes", async () => {
    const { signal } = await startParsing();
    act(() => selectProfile("ech_princess"));
    expect(signal.aborted).toBe(true);
  });
});
