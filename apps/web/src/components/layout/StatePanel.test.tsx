import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { StatePanel } from "@/components/layout/StatePanel";

describe("StatePanel", () => {
  it("announces an error and keeps its action, with a decorative icon", () => {
    const { container } = render(
      <StatePanel icon={Inbox} tone="error" action={<button type="button">Try again</button>}>
        We couldn't load it.
      </StatePanel>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load it.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(container.querySelector('span[aria-hidden="true"] svg')).not.toBeNull();
  });

  it("is quiet for an empty state", () => {
    const { container } = render(
      <StatePanel icon={Inbox} compact>
        Nothing here yet.
      </StatePanel>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Nothing here yet.")).toBeVisible();
    expect(container.querySelector('span[aria-hidden="true"] svg')).not.toBeNull();
  });

  it("renders the full-size empty variant", () => {
    render(<StatePanel icon={Inbox}>Nothing archived yet.</StatePanel>);
    expect(screen.getByText("Nothing archived yet.")).toBeVisible();
  });
});
