import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// BoardColumn's `isOver` highlight comes straight from `useDroppable`. Real
// pointer-driven hover detection isn't reproducible in jsdom, so this stubs
// the hook and drives both states explicitly.
let isOver = false;
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    useDroppable: () => ({ setNodeRef: vi.fn(), isOver }),
  };
});

const { BoardColumn } = await import("@/features/tasks/components/BoardColumn");

beforeEach(() => {
  isOver = false;
});

describe("BoardColumn", () => {
  it("keeps showing the column label and empty state regardless of hover", () => {
    render(<BoardColumn status="todo" label="To do" tasks={[]} timezone="UTC" onOpen={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "To do" })).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    // The empty message has a decorative icon beside it.
    expect(
      screen
        .getByText("Nothing here yet.")
        .parentElement?.querySelector('[aria-hidden="true"] svg'),
    ).not.toBeNull();
  });

  it("names each column's status next to its count, not by color alone", () => {
    render(<BoardColumn status="done" label="Done" tasks={[]} timezone="UTC" onOpen={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByText("0")).toHaveTextContent("0 tasks");
  });

  it("shows the drop-target highlight only while dnd-kit reports a hover over the column", () => {
    // The highlight ring is the branch's only observable effect (no role,
    // label or text changes with it), so this is a deliberate exception to
    // the "assert text/roles, never class strings" convention.
    const { rerender } = render(
      <BoardColumn status="todo" label="To do" tasks={[]} timezone="UTC" onOpen={vi.fn()} />,
    );
    const dropZone = screen.getByTestId("column-dropzone-todo");
    expect(dropZone).not.toHaveClass("ring-2");

    isOver = true;
    rerender(
      <BoardColumn status="todo" label="To do" tasks={[]} timezone="UTC" onOpen={vi.fn()} />,
    );
    expect(dropZone).toHaveClass("ring-2", "ring-primary/30");
  });
});
