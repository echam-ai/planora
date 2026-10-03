import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CategoryBadge,
  DeadlineBadge,
  PriorityBadge,
} from "@/features/tasks/components/TaskBadges";
import { deadlineLabels } from "@/features/tasks/deadline";
import { priorityLabels } from "@/features/tasks/labels";
import type { DeadlineState, TaskPriority } from "@/types";

const states = Object.keys(deadlineLabels) as DeadlineState[];

describe("DeadlineBadge", () => {
  it.each(states)("names itself only through visible text for state %s", (state) => {
    const { container, unmount } = render(<DeadlineBadge state={state} />);
    const badge = container.firstElementChild as HTMLElement;

    expect(badge).not.toHaveAttribute("aria-label");
    expect(badge).not.toHaveAttribute("aria-labelledby");
    expect(badge).not.toHaveAttribute("role");
    expect(badge).not.toHaveAttribute("aria-live");
    expect(badge.querySelector("[aria-label], [aria-labelledby], [role]")).not.toBeInTheDocument();

    expect(badge.textContent).toBe(deadlineLabels[state]);

    const icon = badge.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden");

    unmount();
  });

  it.each(states)("appends the date after the state label for state %s", (state) => {
    const { container, unmount } = render(
      <DeadlineBadge state={state} text="12 Oct 2026, 09:00" />,
    );
    const badge = container.firstElementChild as HTMLElement;

    expect(badge).not.toHaveAttribute("aria-label");
    expect(badge).not.toHaveAttribute("aria-labelledby");
    expect(badge).not.toHaveAttribute("role");
    expect(badge).not.toHaveAttribute("aria-live");

    expect(badge.textContent).toBe(`${deadlineLabels[state]}· 12 Oct 2026, 09:00`);

    unmount();
  });
});

describe("PriorityBadge", () => {
  it.each(Object.keys(priorityLabels) as TaskPriority[])(
    "shows an icon and the words for %s priority, so color is not the only signal",
    (priority) => {
      const { container } = render(<PriorityBadge priority={priority} />);
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.textContent).toBe(`${priorityLabels[priority]} priority`);
      expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden");
    },
  );

  it("uses a different icon for each level", () => {
    const icons = (["low", "medium", "high"] as const).map((priority) => {
      const { container, unmount } = render(<PriorityBadge priority={priority} />);
      const markup = container.querySelector("svg")?.innerHTML;
      unmount();
      return markup;
    });
    expect(new Set(icons).size).toBe(3);
  });
});

describe("CategoryBadge", () => {
  it("names the category in text", () => {
    const { container } = render(<CategoryBadge category="study" />);
    expect(container).toHaveTextContent("Study");
  });
});
