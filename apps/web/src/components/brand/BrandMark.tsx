import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** The Planora logo tile: a sparkle on the theme's brand gradient. Decorative. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-brand-foreground shadow-card",
        className,
      )}
    >
      <Sparkles className="size-[45%]" />
    </span>
  );
}
