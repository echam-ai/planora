import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAdoptDomValue } from "./useAdoptDomValue";

function Field() {
  const [value, setValue] = useState("");
  const ref = useAdoptDomValue<HTMLInputElement>(setValue);
  return (
    <>
      <input
        aria-label="Field"
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <span role="status">{value || "empty"}</span>
    </>
  );
}

describe("useAdoptDomValue", () => {
  it("copies text already in the DOM into state on mount", () => {
    // The DOM already holds text (as after typing into server-rendered markup).
    render(<AdoptExisting text="typed early" />);
    expect(screen.getByRole("status")).toHaveTextContent("typed early");
  });

  it("leaves state empty when nothing was typed", () => {
    render(<Field />);
    expect(screen.getByRole("status")).toHaveTextContent("empty");
    expect(screen.getByLabelText("Field")).toHaveValue("");
  });
});

// Mounts a component whose input already holds text when the effect runs.
function AdoptExisting({ text }: { text: string }) {
  const [value, setValue] = useState("");
  const ref = useAdoptDomValue<HTMLInputElement>(setValue);
  return (
    <>
      <input
        aria-label="Field"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        ref={(el) => {
          if (el) el.value = text;
          (ref as { current: HTMLInputElement | null }).current = el;
        }}
      />
      <span role="status">{value}</span>
    </>
  );
}
