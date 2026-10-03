import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CloudOff } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { ProfileAvatar } from "@/components/brand/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { selectProfile, type ProfileId } from "@/services/api/profiles";
import { APP_NAME } from "@/types";
export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Choose account — Planora" }] }),
  component: AccountChooser,
});

const TAGLINES: Record<ProfileId, string> = {
  hamster_knight: "Brave plans, one quest at a time.",
  ech_princess: "Royal to-dos, beautifully organized.",
};

function ProfilePlaceholder() {
  return (
    <div
      data-testid="profile-placeholder"
      aria-hidden="true"
      className="flex flex-col items-center gap-4 rounded-3xl border border-border bg-card p-6 pb-7 shadow-card"
    >
      <div className="size-32 animate-pulse rounded-full bg-muted sm:size-40" />
      <div className="h-6 w-36 animate-pulse rounded-full bg-muted" />
      <div className="h-4 w-48 max-w-full animate-pulse rounded-full bg-muted" />
    </div>
  );
}

function AccountChooser() {
  const navigate = useNavigate();
  const [choosing, setChoosing] = useState(false);
  const {
    data: profiles,
    isError,
    refetch,
  } = useQuery({ queryKey: ["profiles"], queryFn: () => api.getProfiles() });
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {/* Soft color blobs behind the hero. Pure decoration, tinted by the active theme. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 size-[28rem] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-24 top-1/4 size-96 rounded-full bg-accent blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 size-[26rem] rounded-full bg-secondary blur-3xl" />
      </div>

      <div className="w-full max-w-3xl text-center">
        <div className="inline-flex items-center gap-2.5">
          <BrandMark className="size-10" />
          <span className="text-xl font-semibold tracking-tight">{APP_NAME}</span>
        </div>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight sm:text-4xl">
          Choose your account
        </h1>
        <p className="mx-auto mt-3 max-w-md text-base text-muted-foreground">
          Two separate workspaces. Anyone who can reach Planora can choose either account.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {profiles?.map((profile) => (
            <button
              key={profile.id}
              type="button"
              aria-label={profile.name}
              aria-describedby={`${profile.id}-tagline`}
              disabled={choosing}
              onClick={() => {
                setChoosing(true);
                selectProfile(profile.id);
                navigate({ to: "/tasks" });
              }}
              className="group relative flex min-h-14 cursor-pointer flex-col items-center gap-4 rounded-3xl border border-border bg-card p-6 pb-7 text-center shadow-card transition duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span className="relative">
                <span
                  aria-hidden="true"
                  className="absolute inset-2 rounded-full bg-brand-gradient opacity-25 blur-xl transition-opacity duration-200 group-hover:opacity-50"
                />
                <ProfileAvatar
                  profile={profile.id}
                  className="relative size-32 rounded-full ring-4 ring-card sm:size-40"
                />
              </span>
              <span className="text-xl font-semibold tracking-tight">{profile.name}</span>
              <span id={`${profile.id}-tagline`} className="-mt-2 text-sm text-muted-foreground">
                {TAGLINES[profile.id]}
              </span>
              <span
                aria-hidden="true"
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
              >
                Open workspace
                <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
          {!profiles && !isError && (
            <>
              <ProfilePlaceholder />
              <ProfilePlaceholder />
            </>
          )}
        </div>

        {isError && (
          <div className="mx-auto mt-2 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-card p-6 shadow-card">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive"
            >
              <CloudOff className="size-5" />
            </span>
            <p role="alert" className="text-sm font-medium text-destructive">
              We couldn't load accounts.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}
        {!profiles && !isError && (
          <p role="status" className="mt-6 text-sm text-muted-foreground">
            Loading accounts…
          </p>
        )}
      </div>
    </main>
  );
}
