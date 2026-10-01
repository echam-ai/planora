import { describe, expect, it } from "vitest";
import { countTrimmedCodePoints } from "./textLimits";

describe("API text counting", () => {
  it.each([
    "\u0009",
    "\u000a",
    "\u000b",
    "\u000c",
    "\u000d",
    "\u001c",
    "\u001d",
    "\u001e",
    "\u001f",
    " ",
    "\u0085",
    "\u00a0",
    "\u1680",
    "\u2000",
    "\u2001",
    "\u2002",
    "\u2003",
    "\u2004",
    "\u2005",
    "\u2006",
    "\u2007",
    "\u2008",
    "\u2009",
    "\u200a",
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
  ])("matches Python stripping for %j", (whitespace) => {
    expect(countTrimmedCodePoints(`${whitespace}😀${whitespace}`)).toBe(1);
    expect(countTrimmedCodePoints(whitespace)).toBe(0);
    expect(countTrimmedCodePoints(`a${whitespace}b`)).toBe(3);
  });

  it("counts FEFF and zero-width spaces because Python does not strip them", () => {
    expect(countTrimmedCodePoints("\ufeff😀\ufeff")).toBe(3);
    expect(countTrimmedCodePoints("\u200b😀\u200b")).toBe(3);
  });
});
