"use client";

import { Loader2, Mail } from "lucide-react";
import { usePrivy, useLoginWithOAuth } from "@privy-io/react-auth";
import { toast } from "sonner";

export function PrivyLoginPanel() {
  const { ready, authenticated, login } = usePrivy();
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth();

  if (!ready || authenticated) return null;

  const onError = (label: string, err: unknown) => {
    console.error(`[PrivyLoginPanel] ${label}`, err);
    toast.error(`${label} failed`, {
      description: err instanceof Error ? err.message : "Try again."
    });
  };

  return (
    <div
      id="sign-in"
      className="mt-6 rounded-2xl border border-slate-800/90 bg-slate-950/70 p-4 sm:p-5"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sign in</p>
      <p className="mt-1 text-sm text-slate-400">
        Sign in with Google or email. Your Starknet wallet is created right after you log in.
      </p>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          disabled={oauthLoading}
          onClick={() => {
            void initOAuth({ provider: "google" }).catch((e) => onError("Google sign-in", e));
          }}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:opacity-60"
        >
          {oauthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue with Google
        </button>

        <button
          type="button"
          onClick={() => login({ loginMethods: ["email"] })}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-primary/50 hover:bg-slate-900"
        >
          <Mail className="h-4 w-4 text-primary" aria-hidden />
          Continue with Email
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        After login, the app connects your Starknet wallet automatically (about 10–25 seconds the first time).
      </p>
    </div>
  );
}
