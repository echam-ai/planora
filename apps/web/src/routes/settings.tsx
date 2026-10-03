import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { CloudOff, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { StatePanel } from "@/components/layout/StatePanel";
import { AppearanceSection } from "@/features/settings/components/AppearanceSection";
import { Button } from "@/components/ui/button";
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
import { useProfileGuard } from "@/hooks/useProfileGuard";
import { DemoDataSection } from "@/features/settings/components/DemoDataSection";
import type { AppSettings } from "@/types";
import { DEMO_UI_ENABLED } from "@/services/api/demoUi";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Planora" },
      {
        name: "description",
        content: "Set your timezone and choose the assistant model.",
      },
      { property: "og:title", content: "Settings — Planora" },
      {
        property: "og:description",
        content: "Set your timezone and choose the assistant model.",
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
  useProfileGuard();
  const { data: settings, isError, refetch } = useSettings();
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-muted-foreground">Preferences for this workspace.</p>
        </div>

        <AppearanceSection />

        <section className="space-y-5 rounded-3xl border border-border bg-card p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
            Preferences
          </h2>
          {settings ? (
            <PreferencesForm settings={settings} />
          ) : isError ? (
            <StatePanel
              icon={CloudOff}
              tone="error"
              action={
                <Button className="min-h-11" variant="outline" onClick={() => refetch()}>
                  Try again
                </Button>
              }
            >
              We couldn't load your settings.
            </StatePanel>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </section>

        {DEMO_UI_ENABLED && <DemoDataSection />}
      </div>
    </AppShell>
  );
}
