import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings, useSettingsMutations } from "@/hooks/useApi";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { api } from "@/services/api";

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

const MODELS = ["planora-mini", "planora-pro", "planora-reasoning"];

function SettingsPage() {
  useAuthGuard();
  const qc = useQueryClient();
  const { data: settings, isLoading } = useSettings();
  const { save, changePassword } = useSettingsMutations();

  const [timezone, setTimezone] = useState("UTC");
  const [modelName, setModelName] = useState(MODELS[0]!);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    if (settings) {
      setTimezone(settings.timezone);
      setModelName(settings.modelName);
    }
  }, [settings]);

  const onSave = () =>
    save.mutate(
      { timezone, modelName },
      {
        onSuccess: () => toast.success("Settings saved"),
        onError: () => toast.error("Couldn't save your settings"),
      },
    );

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
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
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
                    {MODELS.map((m) => (
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

        <section className="space-y-3 rounded-2xl border border-dashed border-border p-6">
          <h2 className="text-sm font-semibold">Demo data</h2>
          <p className="text-sm text-muted-foreground">
            Reset everything back to the sample tasks and a fresh conversation.
          </p>
          <Button variant="outline" className="min-h-11" onClick={() => setResetOpen(true)}>
            <RotateCcw className="h-4 w-4" /> Reset demo data
          </Button>
        </section>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              All current tasks, chat history and settings will be replaced with the sample set.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await api.resetDemoData();
                await qc.invalidateQueries();
                toast.success("Demo data reset");
                setResetOpen(false);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
