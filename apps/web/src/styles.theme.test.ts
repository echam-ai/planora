import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Token contract for the three palettes in styles.css (#122).
 *
 * The CSS is the source of truth: this test resolves each theme's custom properties from the
 * stylesheet itself, so a palette edit that breaks legibility, the focus ring, or the
 * amber/red reservation (spec 12.2, binding rule 6) fails here instead of in a screenshot.
 */
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`styles.css has no "${selector}" block`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unterminated "${selector}" block`);
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[match[1]!] = match[2]!.trim().replace(/\s+/g, " ");
  }
  return out;
}

const light = declarations(block('[data-theme="light"]'));
const own = {
  light,
  dark: declarations(block('[data-theme="dark"]')),
  colorful: declarations(block('[data-theme="colorful"]')),
} as const;
const themes = {
  light,
  dark: { ...light, ...own.dark },
  colorful: { ...light, ...own.colorful },
} as const;

type Rgba = [number, number, number, number];
type Oklch = { l: number; c: number; h: number; alpha: number };

const OKLCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/g;

function parseOklchAll(value: string): Oklch[] {
  return [...value.matchAll(OKLCH)].map((m) => ({
    l: Number(m[1]),
    c: Number(m[2]),
    h: Number(m[3]),
    alpha: m[4] === undefined ? 1 : Number(m[4]),
  }));
}

function encode(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function toSrgb({ l, c, h, alpha }: Oklch): Rgba {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    alpha,
  ];
}

function color(theme: keyof typeof themes, token: string): Rgba {
  const value = themes[theme][token];
  if (value === undefined) throw new Error(`${theme} theme has no --${token}`);
  const [first] = parseOklchAll(value);
  if (!first) throw new Error(`--${token} in ${theme} is not an oklch() color: ${value}`);
  return toSrgb(first);
}

/** Composite `top` (with its own alpha, times `opacity`) over an opaque `bottom`, in sRGB. */
function over(top: Rgba, bottom: Rgba, opacity = 1): Rgba {
  const alpha = top[3] * opacity;
  return [
    top[0] * alpha + bottom[0] * (1 - alpha),
    top[1] * alpha + bottom[1] * (1 - alpha),
    top[2] * alpha + bottom[2] * (1 - alpha),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const themeNames = Object.keys(themes) as (keyof typeof themes)[];

describe.each(themeNames)("%s theme", (theme) => {
  const tok = (name: string) => color(theme, name);
  const card = () => over(tok("card"), tok("background"));
  const popover = () => over(tok("popover"), tok("background"));

  const pairs: [string, () => Rgba, () => Rgba][] = [
    ["foreground / background", () => tok("foreground"), () => tok("background")],
    ["card-foreground / card", () => tok("card-foreground"), card],
    ["popover-foreground / popover", () => tok("popover-foreground"), popover],
    ["muted-foreground / background", () => tok("muted-foreground"), () => tok("background")],
    ["muted-foreground / card", () => tok("muted-foreground"), card],
    ["primary-foreground / primary", () => tok("primary-foreground"), () => tok("primary")],
    ["secondary-foreground / secondary", () => tok("secondary-foreground"), () => tok("secondary")],
    ["accent-foreground / accent", () => tok("accent-foreground"), () => tok("accent")],
    ["destructive / background", () => tok("destructive"), () => tok("background")],
    ["destructive / card", () => tok("destructive"), card],
    [
      "destructive-foreground / destructive",
      () => tok("destructive-foreground"),
      () => tok("destructive"),
    ],
    // The five deadline chips, composited over the card exactly as TaskBadges renders them.
    [
      "chip: warning-foreground / warning at 25%",
      () => tok("warning-foreground"),
      () => over(tok("warning"), card(), 0.25),
    ],
    [
      "chip: destructive / destructive at 15%",
      () => tok("destructive"),
      () => over(tok("destructive"), card(), 0.15),
    ],
    [
      "chip: success-foreground / success at 20%",
      () => tok("success-foreground"),
      () => over(tok("success"), card(), 0.2),
    ],
    [
      "chip: secondary-foreground / secondary",
      () => tok("secondary-foreground"),
      () => tok("secondary"),
    ],
    ["chip: muted-foreground / muted", () => tok("muted-foreground"), () => tok("muted")],
    ...(["work", "personal", "study", "other"] as const).map(
      (name): [string, () => Rgba, () => Rgba] => [
        `cat-${name}-foreground / cat-${name}`,
        () => tok(`cat-${name}-foreground`),
        () => tok(`cat-${name}`),
      ],
    ),
  ];

  it.each(pairs)("%s is at least 4.5:1", (_label, fg, bg) => {
    expect(contrast(fg(), bg())).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps text and icons on the brand gradient legible at every stop", () => {
    const stops = parseOklchAll(themes[theme]["gradient-brand"]!);
    expect(stops.length).toBeGreaterThanOrEqual(2);
    for (const stop of stops) {
      expect(contrast(tok("brand-foreground"), toSrgb(stop))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the focus ring at least 3:1 against the page", () => {
    expect(contrast(tok("ring"), tok("background"))).toBeGreaterThanOrEqual(3);
  });

  it("reserves amber for warning and red for destructive", () => {
    const [warning] = parseOklchAll(themes[theme]["warning"]!);
    const [destructive] = parseOklchAll(themes[theme]["destructive"]!);
    expect(warning!.h).toBeGreaterThanOrEqual(55);
    expect(warning!.h).toBeLessThanOrEqual(95);
    expect(destructive!.h).toBeGreaterThanOrEqual(10);
    expect(destructive!.h).toBeLessThanOrEqual(40);

    const reserved = new Set([
      "warning",
      "warning-foreground",
      "destructive",
      "destructive-foreground",
    ]);
    const offenders: string[] = [];
    for (const [name, value] of Object.entries(themes[theme])) {
      if (reserved.has(name)) continue;
      for (const { c, h } of parseOklchAll(value)) {
        const amber = h >= 55 && h <= 95;
        const red = h >= 10 && h <= 40;
        if (c >= 0.08 && (amber || red)) offenders.push(`--${name} (hue ${h}, chroma ${c})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("token definitions", () => {
  it("defines every token in every theme, so no theme inherits another's palette by accident", () => {
    const names = (theme: keyof typeof own) => Object.keys(own[theme]).sort();
    expect(names("dark")).toEqual(names("light"));
    expect(names("colorful")).toEqual(names("light"));
  });
});
