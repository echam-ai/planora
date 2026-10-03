import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { selectProfile } from "@/services/api/profiles";
export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Choose account — Planora" }] }),
  component: AccountChooser,
});
function AccountChooser() {
  const navigate = useNavigate();
  const [choosing, setChoosing] = useState(false);
  const {
    data: profiles,
    isError,
    refetch,
  } = useQuery({ queryKey: ["profiles"], queryFn: () => api.getProfiles() });
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h1 className="text-2xl font-semibold">Choose your account</h1>
        <p className="text-sm text-muted-foreground">
          Two separate workspaces. Anyone who can reach Planora can choose either account.
        </p>
        <div className="space-y-3">
          {profiles?.map((profile) => (
            <Button
              key={profile.id}
              className="min-h-14 w-full"
              disabled={choosing}
              onClick={() => {
                setChoosing(true);
                selectProfile(profile.id);
                navigate({ to: "/tasks" });
              }}
            >
              {profile.name}
            </Button>
          ))}
        </div>
        {isError && (
          <div>
            <p role="alert">We couldn't load accounts.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}
        {!profiles && !isError && <p role="status">Loading accounts…</p>}
      </div>
    </main>
  );
}
