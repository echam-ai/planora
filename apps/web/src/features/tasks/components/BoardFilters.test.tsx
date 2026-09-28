import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BoardFilters } from "@/features/tasks/components/BoardFilters";
import { emptyBoardFilters } from "@/features/tasks/boardFilters";
import { deadlineLabels } from "@/features/tasks/deadline";

describe("BoardFilters", () => {
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

    const high = screen.getByRole("button", { name: "High" });
    fireEvent.click(high);
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: [],
      priorities: ["high"],
      deadlines: [],
    });
    expect(high).toHaveAttribute("aria-pressed", "true");

    const overdue = screen.getByRole("button", { name: deadlineLabels.overdue });
    fireEvent.click(overdue);
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      categories: [],
      priorities: ["high"],
      deadlines: ["overdue"],
    });

    // clicking a selected option again removes just that option
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
