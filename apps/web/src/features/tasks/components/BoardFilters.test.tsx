import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardFilters } from "@/features/tasks/components/BoardFilters";

describe("BoardFilters", () => {
  it("keeps the established labels, defaults, and single-select filter options", () => {
    const onSearchChange = vi.fn();
    const onCategoryChange = vi.fn();
    const onPriorityChange = vi.fn();
    const onDeadlineChange = vi.fn();

    render(
      <BoardFilters
        search=""
        category="all"
        priority="all"
        deadline="all"
        onSearchChange={onSearchChange}
        onCategoryChange={onCategoryChange}
        onPriorityChange={onPriorityChange}
        onDeadlineChange={onDeadlineChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "Ship" } });
    expect(onSearchChange).toHaveBeenCalledWith("Ship");

    for (const [label, options] of [
      ["Filter by category", ["All categories", "Work", "Personal", "Study", "Other"]],
      ["Filter by priority", ["All priorities", "High", "Medium", "Low"]],
      ["Filter by deadline", ["Any deadline", "Due within 24h", "Overdue", "No deadline"]],
    ] as const) {
      const control = screen.getByRole("combobox", { name: label });
      fireEvent.click(control);
      for (const option of options)
        expect(screen.getByRole("option", { name: option })).toBeVisible();
      fireEvent.keyDown(control, { key: "Escape" });
    }
  });
});
