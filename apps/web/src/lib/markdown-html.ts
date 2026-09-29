import type { DOMPurify as DOMPurifyInstance } from "dompurify";

/**
 * Attributes DOMPurify treats as URL-bearing. Checked case-insensitively,
 * after stripping whitespace and ASCII control characters, against a
 * fixed list of unsafe schemes — this is defense in depth on top of
 * DOMPurify's own URI sanitization, matched to spec §9's exact algorithm
 * so the guarantee does not depend on DOMPurify's internal regex staying
 * this strict across versions.
 */
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "xlink:href"];
const UNSAFE_SCHEME_RE = /^(?:javascript|vbscript|data):/i;

function hasUnsafeScheme(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- intentionally strips ASCII control chars (spec §9)
  const normalized = value.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
  return UNSAFE_SCHEME_RE.test(normalized);
}

/**
 * Every link gets `target="_blank"` and a `rel` that carries `noopener`
 * and `noreferrer` (spec §8), overriding any author-supplied `target` and
 * dropping an author-supplied `opener` token. Extra tokens (e.g.
 * `nofollow`) are preserved.
 */
function hardenLink(node: Element): void {
  if (node.tagName !== "A" || !node.hasAttribute("href")) return;
  node.setAttribute("target", "_blank");
  const tokens = (node.getAttribute("rel") ?? "")
    .split(/\s+/)
    .filter((token) => token && token.toLowerCase() !== "opener");
  tokens.push("noopener", "noreferrer");
  node.setAttribute("rel", Array.from(new Set(tokens)).join(" "));
}

let scopedPurify: DOMPurifyInstance | null = null;

/**
 * A DOMPurify instance created via the factory call (`createDOMPurify(window)`)
 * rather than the module's shared default export, so the link-hardening and
 * unsafe-scheme hooks below are scoped to this module and never leak onto
 * any other consumer of the `dompurify` package.
 */
async function getScopedPurify(): Promise<DOMPurifyInstance> {
  if (scopedPurify) return scopedPurify;
  const { default: createDOMPurify } = await import("dompurify");
  const purify = createDOMPurify(window);
  purify.addHook("afterSanitizeAttributes", (node) => {
    for (const attribute of URL_ATTRIBUTES) {
      const value = node.getAttribute(attribute);
      if (value !== null && hasUnsafeScheme(value)) {
        node.removeAttribute(attribute);
      }
    }
    hardenLink(node);
  });
  scopedPurify = purify;
  return purify;
}

/** Parses `source` as GFM Markdown and returns sanitized, safe-to-render HTML. */
export async function renderMarkdownToHtml(source: string): Promise<string> {
  const [{ marked }, purify] = await Promise.all([import("marked"), getScopedPurify()]);
  const raw = await marked.parse(source, { gfm: true, breaks: true });
  return purify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ["form"] });
}
