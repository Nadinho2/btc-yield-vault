"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { usePrivy, useLoginWithOAuth } from "@privy-io/react-auth";
import type { WalletListEntry } from "@privy-io/react-auth";
import { toast } from "sonner";

/** Privy Starknet wallet list ids — enable in the Privy dashboard if missing. */
const starknetWallet = (id: string) => id as WalletListEntry;

export function PrivyLoginPanel() {
  const { ready, authenticated, login, connectWallet } = usePrivy();
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth();
  const [walletOpening, setWalletOpening] = useState<null | "braavos" | "argent">(null);

  if (!ready || authenticated) return null;

  const onError = (label: string, err: unknown) => {
    console.error(`[PrivyLoginPanel] ${label}`, err);
    toast.error(`${label} failed`, {
      description: err instanceof Error ? err.message : "Try again or use another method."
    });
  };

  return (
    <div
      id="sign-in"
      className="mt-6 rounded-2xl border border-slate-800/90 bg-slate-950/70 p-4 sm:p-5"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sign in</p>
      <p className="mt-1 text-sm text-slate-400">
        Use a Starknet browser wallet (recommended) or sign in with Google or email.
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

        <button
          type="button"
          disabled={walletOpening !== null}
          onClick={() => {
            setWalletOpening("braavos");
            try {
              connectWallet({
                walletList: [starknetWallet("braavos")],
                description: "Connect Braavos on Starknet"
              });
            } catch (e) {
              onError("Braavos", e);
            } finally {
              setTimeout(() => setWalletOpening(null), 800);
            }
          }}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:border-sky-400/60 hover:bg-sky-500/15 disabled:opacity-60"
        >
          {walletOpening === "braavos" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Connect with Braavos
        </button>

        <button
          type="button"
          disabled={walletOpening !== null}
          onClick={() => {
            setWalletOpening("argent");
            try {
              connectWallet({
                walletList: [starknetWallet("argent")],
                description: "Connect Ready Wallet (Argent) on Starknet"
              });
            } catch (e) {
              onError("Ready Wallet", e);
            } finally {
              setTimeout(() => setWalletOpening(null), 800);
            }
          }}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:border-violet-400/60 hover:bg-violet-500/15 disabled:opacity-60"
        >
          {walletOpening === "argent" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Connect with Ready Wallet
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        WalletConnect is available from the Privy modal when you pick other connection options. Enable Starknet + Braavos
        / Argent in your{" "}
        <a
          href="https://dashboard.privy.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 underline decoration-slate-600 underline-offset-2 hover:text-slate-300"
        >
          Privy dashboard
        </a>{" "}
        if a method is missing.
      </p>
    </div>
  );
}
