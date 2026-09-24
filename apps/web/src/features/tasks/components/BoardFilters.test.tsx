import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BoardFilters } from "@/features/tasks/components/BoardFilters";
import { emptyBoardFilters } from "@/features/tasks/boardFilters";

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
});
