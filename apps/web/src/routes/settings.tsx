import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings, useSettingsMutations } from "@/features/settings/hooks";
import { useAdoptDomValue } from "@/hooks/useAdoptDomValue";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { DemoDataSection } from "@/features/settings/components/DemoDataSection";
import type { AppSettings } from "@/types";
import { DEMO_UI_ENABLED } from "@/services/api/demoUi";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Planora" },
      {
        name: "description",
        content: "Set your timezone, choose the assistant model, and change your password.",
      },
      { property: "og:title", content: "Settings — Planora" },
      {
        property: "og:description",
        content: "Set your timezone, choose the assistant model, and change your password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

const TIMEZONES = [
  "UTC",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
];

function PreferencesForm({ settings }: { settings: AppSettings }) {
  const { save } = useSettingsMutations();
  const [timezone, setTimezone] = useState(settings.timezone);
  const [modelName, setModelName] = useState(settings.modelName);

  const onSave = () =>
    save.mutate(
      { timezone, modelName },
      {
        onSuccess: () => toast.success("Settings saved"),
        onError: () => toast.error("Couldn't save your settings"),
      },
    );

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="tz">Timezone</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id="tz">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="model">Assistant model</Label>
        <Select value={modelName} onValueChange={setModelName}>
          <SelectTrigger id="model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {settings.availableModels.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button className="min-h-11" onClick={onSave} disabled={save.isPending}>
        Save changes
      </Button>
    </>
  );
}

function SettingsPage() {
  useAuthGuard();
  const { data: settings, isError, refetch } = useSettings();
  const { changePassword } = useSettingsMutations();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  // Fields are usable before hydration; keep whatever was typed then.
  const currentRef = useAdoptDomValue<HTMLInputElement>(setCurrent);
  const nextRef = useAdoptDomValue<HTMLInputElement>(setNext);
  const [pwError, setPwError] = useState<string | null>(null);

  const onChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (next.length < 6) {
      setPwError("New password must be at least 6 characters.");
      return;
    }
    changePassword.mutate(
      { current, next },
      {
        onSuccess: () => {
          toast.success("Password updated");
          setCurrent("");
          setNext("");
        },
        onError: (e2) => setPwError(e2 instanceof Error ? e2.message : "Couldn't update password"),
      },
    );
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Preferences for this workspace.</p>
        </div>

        <section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-sm font-semibold">Preferences</h2>
          {settings ? (
            <PreferencesForm settings={settings} />
          ) : isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <p role="alert" className="text-sm text-destructive">
                We couldn't load your settings.
              </p>
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </section>

        <form
          onSubmit={onChangePassword}
          className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card"
        >
          <h2 className="text-sm font-semibold">Change password</h2>
          <div className="space-y-2">
            <Label htmlFor="cur">Current password</Label>
            <Input
              id="cur"
              ref={currentRef}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new">New password</Label>
            <Input
              id="new"
              ref={nextRef}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          {pwError && (
            <p role="alert" className="text-sm text-destructive">
              {pwError}
            </p>
          )}
          <Button type="submit" className="min-h-11" disabled={changePassword.isPending}>
            Update password
          </Button>
        </form>

        {DEMO_UI_ENABLED && <DemoDataSection />}
      </div>
    </AppShell>
  );
}
