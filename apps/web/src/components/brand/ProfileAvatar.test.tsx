import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileAvatar } from "@/components/brand/ProfileAvatar";

describe("ProfileAvatar", () => {
  it("draws a hamster with a knight's helmet, shield and sword for Hamster Knight", () => {
    const { container } = render(<ProfileAvatar profile="hamster_knight" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-mascot", "hamster");
    for (const part of ["helmet", "shield", "sword"]) {
      expect(svg?.querySelector(`[data-part="${part}"]`)).not.toBeNull();
    }
    expect(svg?.querySelector('[data-part="crown"]')).toBeNull();
  });

  it("draws a frog wearing a crown for Ech Princess", () => {
    const { container } = render(<ProfileAvatar profile="ech_princess" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-mascot", "frog");
    expect(svg?.querySelector('[data-part="crown"]')).not.toBeNull();
    expect(svg?.querySelector('[data-part="helmet"]')).toBeNull();
  });

  it("passes sizing through and keeps clip ids unique across instances", () => {
    const { container } = render(
      <>
        <ProfileAvatar profile="hamster_knight" className="size-9" />
        <ProfileAvatar profile="hamster_knight" className="size-24" />
      </>,
    );
    const [first, second] = Array.from(container.querySelectorAll("svg"));
    expect(first).toHaveClass("size-9");
    expect(second).toHaveClass("size-24");
    const ids = Array.from(container.querySelectorAll("clipPath")).map((node) => node.id);
    expect(new Set(ids).size).toBe(2);
    for (const svg of [first, second]) {
      const clipId = svg?.querySelector("clipPath")?.id;
      expect(svg?.querySelector("g[clip-path]")).toHaveAttribute("clip-path", `url(#${clipId})`);
    }
  });
});
