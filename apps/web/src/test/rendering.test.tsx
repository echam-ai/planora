import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Fixture() {
  return <p>Test environment is ready</p>;
}

describe("React Testing Library setup", () => {
  it("renders a component in jsdom", () => {
    render(<Fixture />);

    expect(screen.getByText("Test environment is ready")).toBeInTheDocument();
  });
});
