import { useEffect, useState } from "react";
import { renderMarkdownToHtml } from "@/lib/markdown-html";

export function MarkdownPreview({ source }: { source: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const clean = await renderMarkdownToHtml(source || "");
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
