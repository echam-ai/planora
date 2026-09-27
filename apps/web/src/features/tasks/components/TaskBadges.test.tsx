import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeadlineBadge } from "@/features/tasks/components/TaskBadges";
import { deadlineLabels } from "@/features/tasks/deadline";
import type { DeadlineState } from "@/types";

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
