import { Check } from "lucide-react";
import { THEME_OPTIONS, parseThemePreference, useTheme, type ResolvedTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * A miniature app drawn with the tokens of one theme. `data-theme` re-scopes every custom
 * property below it, so the preview is the real palette, not a screenshot that can drift.
 */
function ThemeMini({ theme, className }: { theme: ResolvedTheme; className?: string }) {
  return (
    <div
      data-theme={theme}
      style={{ backgroundImage: "var(--page-bg)" }}
      className={cn("flex h-full flex-col gap-1.5 bg-background p-2.5", className)}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-md bg-brand-gradient" />
        <span className="h-1.5 w-8 rounded-full bg-foreground/60" />
        <span className="ml-auto h-3 w-6 rounded-full bg-primary" />
      </div>
      <div className="grid flex-1 grid-cols-2 gap-1.5">
        <div className="space-y-1 rounded-md border border-border bg-card p-1.5 shadow-card">
          <span className="block h-1.5 w-8 rounded-full bg-card-foreground/70" />
          <span className="block h-2 w-6 rounded-full bg-cat-work" />
        </div>
        <div className="space-y-1 rounded-md border border-border bg-card p-1.5 shadow-card">
          <span className="block h-1.5 w-6 rounded-full bg-card-foreground/70" />
          <span className="block h-2 w-8 rounded-full bg-cat-personal" />
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ theme }: { theme: "system" | ResolvedTheme }) {
  return (
    <div
      aria-hidden="true"
      className="relative h-20 overflow-hidden rounded-xl border border-border"
    >
      <ThemeMini theme={theme === "system" ? "light" : theme} />
      {theme === "system" && (
        <ThemeMini
          theme="dark"
          className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
        />
      )}
    </div>
  );
}

export function AppearanceSection() {
  const { preference, setPreference } = useTheme();
  return (
    <section
      aria-labelledby="appearance-heading"
      className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-card"
    >
      <div>
        <h2 id="appearance-heading" className="text-base font-semibold tracking-tight">
          Appearance
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Applies to this browser, for both accounts.
        </p>
      </div>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {THEME_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="group relative flex cursor-pointer flex-col gap-2 rounded-2xl border border-border bg-background p-2 transition-colors duration-150 hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/30 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={preference === option.value}
              onChange={(event) => setPreference(parseThemePreference(event.target.value))}
              className="absolute inset-0 z-10 size-full cursor-pointer appearance-none opacity-0"
            />
            <ThemePreview theme={option.value} />
            <span className="flex min-h-6 items-center justify-between px-1 text-sm font-medium">
              {option.label}
              <Check
                aria-hidden="true"
                className="size-4 text-primary opacity-0 group-has-[:checked]:opacity-100"
              />
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
