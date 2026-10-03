import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * An empty or error state: an `aria-hidden` icon in a soft tinted circle beside the message, and
 * an optional action. Errors are announced (`role="alert"`) so the failure is not silent; the
 * red tint is never the only signal because the message always says what went wrong.
 */
export function StatePanel({
  icon: Icon,
  tone = "empty",
  compact = false,
  action,
  className,
  children,
}: {
  icon: LucideIcon;
  tone?: "empty" | "error";
  compact?: boolean;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const error = tone === "error";
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 px-2 py-6" : "gap-3 rounded-2xl border p-8",
        !compact &&
          (error ? "border-destructive/30 bg-card" : "border-dashed border-border bg-card/60"),
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-full",
          compact ? "size-9" : "size-12",
          error ? "bg-destructive/15 text-destructive" : "bg-secondary text-secondary-foreground",
        )}
      >
        <Icon className={compact ? "size-4" : "size-5"} />
      </span>
      <p
        role={error ? "alert" : undefined}
        className={cn(
          compact ? "text-xs" : "text-sm",
          error ? "font-medium text-destructive" : "text-muted-foreground",
        )}
      >
        {children}
      </p>
      {action}
    </div>
  );
}
