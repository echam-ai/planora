import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BoardFilters } from "@/features/tasks/components/BoardFilters";
import { emptyBoardFilters, type BoardFiltersState } from "@/features/tasks/boardFilters";
import { deadlineLabels } from "@/features/tasks/deadline";

function ButtonAfterToolbar() {
  return <button type="button">After toolbar</button>;
}

describe("BoardFilters", () => {
  it("shows named compact triggers and opens only one labeled dimension at a time", () => {
    render(
      <BoardFilters
        search=""
        filters={emptyBoardFilters}
        onSearchChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("search", { name: "Task search" })).toContainElement(
      screen.getByRole("textbox", { name: "Search tasks" }),
    );
    expect(screen.getByRole("region", { name: "Board filters" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();
    for (const label of ["Category", "Priority", "Deadline"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: `${label} filters` })).toBeVisible();
      expect(screen.getByRole("group", { name: label })).toBeVisible();
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("updates counts and selected-label descriptions immediately while the popover stays open", async () => {
    function Filters() {
      const [filters, setFilters] = useState(emptyBoardFilters);
      return (
        <BoardFilters
          search=""
          filters={filters}
          onSearchChange={vi.fn()}
          onFiltersChange={setFilters}
        />
      );
    }
    render(<Filters />);
    fireEvent.click(screen.getByRole("button", { name: "Category" }));
    const work = screen.getByRole("button", { name: "Work" });
    await waitFor(() => expect(work).toHaveFocus());
    fireEvent.click(work);
    fireEvent.click(screen.getByRole("button", { name: "Personal" }));
    expect(screen.getByRole("button", { name: "Category 2" })).toHaveAccessibleDescription(
      "Selected: Work, Personal",
    );
    expect(screen.getByRole("dialog", { name: "Category filters" })).toBeVisible();
    fireEvent.click(work);
    expect(screen.getByRole("button", { name: "Category 1" })).toHaveAccessibleDescription(
      "Selected: Personal",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close Category filters" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Category 1" })).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears the controlled search and selected indicators in every dimension", () => {
    function Filters() {
      const [search, setSearch] = useState("No matching task");
      const [filters, setFilters] = useState<BoardFiltersState>({
        categories: ["work"],
        priorities: ["high"],
        deadlines: ["overdue"],
      });
      return (
        <BoardFilters
          search={search}
          filters={filters}
          onSearchChange={setSearch}
          onFiltersChange={setFilters}
        />
      );
    }
    render(<Filters />);
    for (const [label, name] of [
      ["Category", "Work"],
      ["Priority", "High"],
      ["Deadline", "Overdue"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: `${label} 1` }));
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name }).querySelector("svg")).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(screen.getByRole("textbox", { name: "Search tasks" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();
    for (const label of ["Category", "Priority", "Deadline"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAccessibleDescription(
        "No selections",
      );
    }
    for (const option of screen.queryAllByRole("button", { pressed: false })) {
      expect(option.querySelector("svg")).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
    for (const label of ["Category", "Priority", "Deadline"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      for (const option of screen.getAllByRole("button", { pressed: false })) {
        expect(option.querySelector("svg")).not.toBeInTheDocument();
      }
    }
  });

  it("lets keyboard focus leave the options in both directions rather than cycling", async () => {
    const rectangles = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([{}] as unknown as DOMRectList);
    try {
      render(
        <>
          <BoardFilters
            search=""
            filters={emptyBoardFilters}
            onSearchChange={vi.fn()}
            onFiltersChange={vi.fn()}
          />
          <ButtonAfterToolbar />
        </>,
      );
      const category = screen.getByRole("button", { name: "Category" });
      fireEvent.click(category);
      const work = screen.getByRole("button", { name: "Work" });
      await waitFor(() => expect(work).toHaveFocus());
      fireEvent.keyDown(work, { key: "ArrowDown" });
      expect(screen.getByRole("dialog", { name: "Category filters" })).toBeVisible();
      fireEvent.keyDown(work, { key: "Tab", shiftKey: true });
      await waitFor(() => expect(category).toHaveFocus());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(category);
      const close = screen.getByRole("button", { name: "Close Category filters" });
      close.focus();
      fireEvent.keyDown(close, { key: "Tab" });
      await waitFor(() => expect(screen.getByRole("button", { name: "Priority" })).toHaveFocus());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
      const deadlineClose = screen.getByRole("button", { name: "Close Deadline filters" });
      deadlineClose.focus();
      fireEvent.keyDown(deadlineClose, { key: "Tab" });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "After toolbar" })).toHaveFocus(),
      );
    } finally {
      rectangles.mockRestore();
    }
  });

  it("makes reset available for search alone and hides it after clearing", () => {
    function Filters() {
      const [search, setSearch] = useState("");
      return (
        <BoardFilters
          search={search}
          filters={emptyBoardFilters}
          onSearchChange={setSearch}
          onFiltersChange={vi.fn()}
        />
      );
    }
    render(<Filters />);
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(screen.getByLabelText("Search tasks")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();
  });

  it("allows multiple accessible selections in each dimension and clears every filter", () => {
    const onSearchChange = vi.fn();
    const onFiltersChange = vi.fn();

    function Filters() {
      const [filters, setFilters] = useState(emptyBoardFilters);
      return (
        <BoardFilters
          search=""
          filters={filters}
          onSearchChange={onSearchChange}
          onFiltersChange={(value) => {
            onFiltersChange(value);
            setFilters(value);
          }}
        />
      );
    }

    render(<Filters />);

    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "Ship" } });
    expect(onSearchChange).toHaveBeenCalledWith("Ship");

    fireEvent.click(screen.getByRole("button", { name: "Category" }));
    const work = screen.getByRole("button", { name: "Work" });
    const personal = screen.getByRole("button", { name: "Personal" });
    expect(screen.getByRole("group", { name: "Category" })).toBeVisible();
    expect(work).toHaveAttribute("aria-pressed", "false");
    expect(work.querySelector("svg")).not.toBeInTheDocument();
    fireEvent.click(work);
    expect(work.querySelector("svg")).toBeVisible();
    fireEvent.click(personal);
    expect(onFiltersChange).toHaveBeenNthCalledWith(1, {
      categories: ["work"],
      priorities: [],
      deadlines: [],
    });
    expect(onFiltersChange).toHaveBeenNthCalledWith(2, {
      categories: ["work", "personal"],
      priorities: [],
      deadlines: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    expect(screen.getByRole("button", { name: "Scheduled" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("button", { name: "Completed" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: [],
      priorities: [],
      deadlines: [],
    });
  });

  it("selects and deselects options in the Priority and Deadline groups independently of Category", () => {
    const onFiltersChange = vi.fn();

    function Filters() {
      const [filters, setFilters] = useState(emptyBoardFilters);
      return (
        <BoardFilters
          search=""
          filters={filters}
          onSearchChange={vi.fn()}
          onFiltersChange={(value) => {
            onFiltersChange(value);
            setFilters(value);
          }}
        />
      );
    }

    render(<Filters />);

    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    let high = screen.getByRole("button", { name: "High" });
    fireEvent.click(high);
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: [],
      priorities: ["high"],
      deadlines: [],
    });
    expect(high).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    const overdue = screen.getByRole("button", { name: deadlineLabels.overdue });
    fireEvent.click(overdue);
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: [],
      priorities: ["high"],
      deadlines: ["overdue"],
    });

    // clicking a selected option again removes just that option
    fireEvent.click(screen.getByRole("button", { name: "Priority 1" }));
    high = screen.getByRole("button", { name: "High" });
    fireEvent.click(high);
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: [],
      priorities: [],
      deadlines: ["overdue"],
    });
    expect(high).toHaveAttribute("aria-pressed", "false");
    expect(high.querySelector("svg")).not.toBeInTheDocument();
  });

  it("names the Deadline filter options from deadlineLabels so they cannot drift from the badge", () => {
    render(
      <BoardFilters
        search=""
        filters={emptyBoardFilters}
        onSearchChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    const group = screen.getByRole("group", { name: "Deadline" });
    const optionNames = screen
      .getAllByRole("button", { name: /.*/ })
      .filter((button) => group.contains(button))
      .map((button) => button.textContent);

    expect(optionNames).toEqual([
      deadlineLabels.none,
      deadlineLabels.scheduled,
      deadlineLabels.due_soon,
      deadlineLabels.overdue,
    ]);
  });
});
