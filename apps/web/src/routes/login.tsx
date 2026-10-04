import { createFileRoute } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { UnlockForm } from "@/features/auth/components/UnlockForm";
import { APP_NAME } from "@/types";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Unlock — Planora" }] }),
  component: UnlockPage,
});

function UnlockPage() {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {/* The chooser's soft blobs, so the two pages read as one front door. Decoration only. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 size-[28rem] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-24 top-1/4 size-96 rounded-full bg-accent blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 size-[26rem] rounded-full bg-secondary blur-3xl" />
      </div>

      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center gap-2.5">
          <BrandMark className="size-10" />
          <span className="text-xl font-semibold tracking-tight">{APP_NAME}</span>
        </div>
        <span
          aria-hidden="true"
          className="mx-auto mt-8 flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
        >
          <LockKeyhole className="size-5" />
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Unlock Planora</h1>
        <p className="mx-auto mt-3 max-w-xs text-base text-muted-foreground">
          Enter the shared password to choose an account.
        </p>
        <div className="mt-8">
          <UnlockForm />
        </div>
      </div>
    </main>
  );
}
