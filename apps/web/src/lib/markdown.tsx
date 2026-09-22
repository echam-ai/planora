import { useEffect, useState } from "react";

export function MarkdownPreview({ source }: { source: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ marked }, DOMPurifyMod] = await Promise.all([import("marked"), import("dompurify")]);
      const DOMPurify = DOMPurifyMod.default;
      const raw = await marked.parse(source || "", { gfm: true, breaks: true });
      const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
      if (!cancelled) setHtml(clean);
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (!source.trim()) {
    return <p className="text-sm text-muted-foreground">No note yet.</p>;
  }

  if (html === null) {
    return <p className="text-sm text-muted-foreground">Rendering preview…</p>;
  }

  return (
    <div
      className="prose-planora text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
