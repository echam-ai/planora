import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownPreview } from "./markdown";
import { renderMarkdownToHtml } from "./markdown-html";

/** Parses sanitized HTML into a detached DOM so attributes can be read with `getAttribute`. */
function parse(html: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

async function renderAndParse(source: string): Promise<HTMLDivElement> {
  return parse(await renderMarkdownToHtml(source));
}

function hasOnAttribute(root: Element): boolean {
  return Array.from(root.querySelectorAll("*")).some((el) =>
    Array.from(el.attributes).some((attr) => attr.name.toLowerCase().startsWith("on")),
  );
}

describe("renderMarkdownToHtml — script and unsafe elements are removed", () => {
  it("strips inline and sourced script tags", async () => {
    const a = await renderAndParse("<script>alert(1)</script>");
    expect(a.querySelector("script")).toBeNull();

    const b = await renderAndParse('<SCRIPT src="https://evil.example/x.js"></SCRIPT>');
    expect(b.querySelector("script")).toBeNull();
  });

  it("strips iframe, object, embed and form", async () => {
    const iframe = await renderAndParse('<iframe src="https://example.com"></iframe>');
    expect(iframe.querySelector("iframe")).toBeNull();

    const object = await renderAndParse('<object data="x"></object>');
    expect(object.querySelector("object")).toBeNull();

    const embed = await renderAndParse('<embed src="x">');
    expect(embed.querySelector("embed")).toBeNull();

    const form = await renderAndParse('<form action="x"><input></form>');
    expect(form.querySelector("form")).toBeNull();
  });

  it("strips style tags", async () => {
    const root = await renderAndParse("<style>body{display:none}</style>");
    expect(root.querySelector("style")).toBeNull();
  });

  it("strips svg elements including onload handlers", async () => {
    const root = await renderAndParse('<svg onload="alert(1)"><circle r="1"/></svg>');
    expect(root.querySelector("svg")).toBeNull();
    expect(hasOnAttribute(root)).toBe(false);
  });
});

describe("renderMarkdownToHtml — event handlers are stripped", () => {
  it("strips onerror from img but keeps the element", async () => {
    const root = await renderAndParse('<img src="x" onerror="alert(1)">');
    const img = root.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("strips onclick from p but keeps the text", async () => {
    const root = await renderAndParse('<p onclick="alert(1)">hi</p>');
    expect(root.querySelector("p")?.getAttribute("onclick")).toBeNull();
    expect(root.textContent).toContain("hi");
  });

  it("leaves no on* attribute anywhere across the whole payload corpus", async () => {
    const corpus = [
      "<script>alert(1)</script>",
      '<SCRIPT src="https://evil.example/x.js"></SCRIPT>',
      '<iframe src="https://example.com"></iframe>',
      '<object data="x"></object>',
      '<embed src="x">',
      '<form action="x"><input></form>',
      "<style>body{display:none}</style>",
      '<svg onload="alert(1)"><circle r="1"/></svg>',
      '<img src="x" onerror="alert(1)">',
      '<p onclick="alert(1)">hi</p>',
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      '<a href="javascript:alert(1)">x</a>',
      '<a href=" javascript:alert(1)">x</a>',
      '<a href="java&#x09;script:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)">x</a>',
      "[x](&#106;avascript:alert(1))",
      "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    ].join("\n\n");
    const root = await renderAndParse(corpus);
    expect(hasOnAttribute(root)).toBe(false);
  });
});

describe("renderMarkdownToHtml — unsafe URL schemes are neutralised", () => {
  function expectNoUnsafeHref(root: HTMLDivElement) {
    for (const a of root.querySelectorAll("a")) {
      const href = a.getAttribute("href");
      if (href === null) continue;
      // eslint-disable-next-line no-control-regex -- intentionally strips ASCII control chars (spec §9)
      const normalized = href.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
      expect(normalized).not.toMatch(/^(?:javascript|vbscript|data):/);
    }
  }

  it.each([
    ["markdown link, lowercase scheme", "[x](javascript:alert(1))"],
    ["markdown link, mixed-case scheme", "[x](JaVaScRiPt:alert(1))"],
    ["raw HTML link", '<a href="javascript:alert(1)">x</a>'],
    ["raw HTML link, leading space", '<a href=" javascript:alert(1)">x</a>'],
    ["raw HTML link, entity-encoded tab", '<a href="java&#x09;script:alert(1)">x</a>'],
    ["raw HTML link, decimal-entity scheme", '<a href="&#106;avascript:alert(1)">x</a>'],
    [
      "raw HTML link, fully hex-entity-encoded scheme",
      '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)">x</a>',
    ],
    ["markdown link, decimal-entity scheme", "[x](&#106;avascript:alert(1))"],
    [
      "markdown link, base64 data URL",
      "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    ],
    [
      "raw HTML link, data URL with embedded script",
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    ],
  ])("%s renders link text with no unsafe-scheme href", async (_label, source) => {
    const root = await renderAndParse(source);
    expect(root.textContent).toContain("x");
    expectNoUnsafeHref(root);
  });
});

describe("renderMarkdownToHtml — unsafe schemes are checked on every URL-bearing attribute", () => {
  it("strips an unsafe scheme from an img src, not only from href", async () => {
    const root = await renderAndParse('<img src="javascript:alert(1)">');
    const img = root.querySelector("img");
    const src = img?.getAttribute("src") ?? null;
    if (src !== null) {
      // eslint-disable-next-line no-control-regex -- intentionally strips ASCII control chars (spec §9)
      const normalized = src.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
      expect(normalized).not.toMatch(/^javascript:/);
    }
  });
});

describe("renderMarkdownToHtml — every link opens in a new tab with safe attributes (spec §8)", () => {
  function expectHardened(a: Element, { forbidden }: { forbidden?: string } = {}) {
    expect(a.getAttribute("target")).toBe("_blank");
    const relTokens = (a.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean);
    expect(relTokens).toContain("noopener");
    expect(relTokens).toContain("noreferrer");
    if (forbidden) expect(relTokens).not.toContain(forbidden);
  }

  it("hardens a Markdown link", async () => {
    const root = await renderAndParse("[Planora](https://example.com/docs)");
    const a = root.querySelector('a[href="https://example.com/docs"]');
    expect(a).not.toBeNull();
    expectHardened(a as Element);
  });

  it("hardens a bare GFM autolink", async () => {
    const root = await renderAndParse("https://example.com/auto");
    const a = root.querySelector('a[href="https://example.com/auto"]');
    expect(a).not.toBeNull();
    expectHardened(a as Element);
  });

  it("hardens an angle-bracket autolink", async () => {
    const root = await renderAndParse("<https://example.com/angle>");
    const a = root.querySelector('a[href="https://example.com/angle"]');
    expect(a).not.toBeNull();
    expectHardened(a as Element);
  });

  it("hardens a raw-HTML link", async () => {
    const root = await renderAndParse('<a href="https://example.com/raw">x</a>');
    const a = root.querySelector('a[href="https://example.com/raw"]');
    expect(a).not.toBeNull();
    expectHardened(a as Element);
  });

  it("overrides an author-supplied target and rel, dropping the opener token", async () => {
    const root = await renderAndParse(
      '<a href="https://example.com/o" target="_self" rel="opener">x</a>',
    );
    const a = root.querySelector('a[href="https://example.com/o"]');
    expect(a).not.toBeNull();
    expectHardened(a as Element, { forbidden: "opener" });
  });
});

describe("renderMarkdownToHtml — ordinary Markdown still renders", () => {
  it("renders headings, lists, code, emphasis and links with text intact", async () => {
    const source = [
      "# H1",
      "## H2",
      "- a",
      "- b",
      "1. one",
      "`inline`",
      "```",
      "fenced",
      "```",
      "*em*",
      "**strong**",
      "[link](https://example.com)",
    ].join("\n\n");
    const root = await renderAndParse(source);

    expect(root.querySelector("h1")?.textContent).toBe("H1");
    expect(root.querySelector("h2")?.textContent).toBe("H2");
    expect(root.querySelectorAll("ul > li")).toHaveLength(2);
    expect(root.querySelectorAll("ol > li")).toHaveLength(1);
    expect(root.querySelector("code")?.textContent).toBe("inline");
    expect(root.querySelector("pre > code")?.textContent).toContain("fenced");
    expect(root.querySelector("em")?.textContent).toBe("em");
    expect(root.querySelector("strong")?.textContent).toBe("strong");
    const link = root.querySelector('a[href="https://example.com"]');
    expect(link?.textContent).toBe("link");
  });

  it("shows a script tag inside a fenced code block as literal text, not an element", async () => {
    const root = await renderAndParse("```\n<script>alert(1)</script>\n```");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("pre > code")?.textContent).toContain("<script>alert(1)</script>");
  });

  it("preserves line breaks inside a paragraph as <br> (breaks: true)", async () => {
    const root = await renderAndParse("line one\nline two");
    expect(root.querySelector("br")).not.toBeNull();
  });
});

describe("MarkdownPreview", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('shows "No note yet." for an empty note', () => {
    render(<MarkdownPreview source="" />);
    expect(screen.getByText("No note yet.")).toBeInTheDocument();
  });

  it('shows "No note yet." for a whitespace-only note', () => {
    render(<MarkdownPreview source={"   \n  "} />);
    expect(screen.getByText("No note yet.")).toBeInTheDocument();
  });

  it("renders the full malicious payload corpus without executing anything", async () => {
    const payload = [
      '<img src="x" onerror="alert(1)">',
      "<script>alert(1)</script>",
      "[x](javascript:alert(1))",
      "# Heading",
      "[Planora](https://example.com/docs)",
      '<iframe src="https://example.com"></iframe>',
      '<svg onload="alert(1)"><circle r="1"/></svg>',
    ].join("\n\n");

    const { container } = render(<MarkdownPreview source={payload} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Heading" })).toBeInTheDocument();
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(hasOnAttribute(container)).toBe(false);

    const link = container.querySelector('a[href="https://example.com/docs"]');
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
  });
});
