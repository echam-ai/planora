import { afterEach, describe, expect, it, vi } from "vitest";
import { uid } from "@/lib/id";

describe("uid", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the established default and supplied-prefix ID format", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);

    expect(uid()).toBe(`id_${(0.5).toString(36).slice(2, 10)}`);
    expect(uid("url")).toBe(`url_${(0.25).toString(36).slice(2, 10)}`);
  });
});
