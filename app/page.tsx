"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useStarkzapWallet } from "@/hooks/useStarkzap";
import {
  ArrowRight,
  Bitcoin,
  EyeOff,
  ShieldCheck,
  Sparkles,
  Wallet,
  Clock3,
  ArrowUpRight,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { DCAForm } from "@/components/DCAForm";
import { AutoLendVault } from "@/components/AutoLendVault";
import { StarknetAddressCard } from "@/components/StarknetAddressCard";

export default function HomePage() {
  const {
    sdk: starkzap,
    address: walletAddress,
    balancePreview,
    walletReady,
    walletLoading,
    walletStatusText,
    walletError,
    wallet
  } = useStarkzapWallet();
  const { ready, authenticated, login, logout } = usePrivy();
  const [privateMode, setPrivateMode] = useState(true);
  const [portfolioValue, setPortfolioValue] = useState(14500);
  const [txHistory, setTxHistory] = useState<unknown[]>([]);
  const didToastConnected = useRef(false);

  useEffect(() => {
    if (walletReady && !didToastConnected.current) {
      didToastConnected.current = true;
      toast.success("Wallet connected", {
        description: "Your Starknet wallet is ready."
      });
    }
    if (!authenticated) {
      didToastConnected.current = false;
    }
  }, [walletReady, authenticated]);

  useEffect(() => {
    if (!walletReady || !wallet) {
      setTxHistory([]);
      return;
    }
    let cancelled = false;
    const sdkAny = starkzap as { getHistory?: () => Promise<unknown> };
    const wAny = wallet as { getHistory?: () => Promise<unknown> };

    const run = async () => {
      try {
        if (typeof wAny.getHistory === "function") {
          const h = await wAny.getHistory();
          if (!cancelled && Array.isArray(h)) setTxHistory(h);
          return;
        }
        if (typeof sdkAny.getHistory === "function") {
          const h = await sdkAny.getHistory();
          if (!cancelled && Array.isArray(h)) setTxHistory(h);
          return;
        }
        if (!cancelled) setTxHistory([]);
      } catch {
        if (!cancelled) setTxHistory([]);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [walletReady, wallet, starkzap]);

  const shortAddress =
    walletAddress && `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;

  const balanceLabel = useMemo(() => {
    if (!balancePreview) return undefined;
    return balancePreview.includes("BTC") ? balancePreview : `${balancePreview} (balance)`;
  }, [balancePreview]);

  const handlePrimaryAction = () => {
    if (!ready) return;
    if (!authenticated) {
      login();
    } else {
      toast("Coming soon", {
        description: "Strategy configuration will appear here in the next iteration."
      });
    }
  };

  return (
    <main className="flex min-h-screen flex-col px-4 pb-12 pt-6 sm:px-6 lg:px-10 lg:pt-10">
      <header className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/50">
            <Bitcoin className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex flex-col">
            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
              BTC Yield Vault
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-300">
                TESTNET
              </span>
            </span>
            <span className="text-xs text-slate-400">
              Gasless yield on Bitcoin, powered by Starknet
            </span>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <label className="flex w-full min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 sm:w-auto sm:min-h-0 sm:justify-start sm:rounded-full sm:py-1.5">
            <span className="flex items-center gap-2">
              <EyeOff className="h-3.5 w-3.5 shrink-0 text-primary" />
              Private mode
            </span>
            <input
              type="checkbox"
              checked={privateMode}
              onChange={(e) => setPrivateMode(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-primary"
              aria-label="Private mode"
            />
          </label>

          {authenticated && walletLoading && (
            <span className="flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 py-2 text-xs text-slate-400 sm:min-h-0 sm:rounded-full sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="min-w-0 break-words">{walletStatusText ?? "Preparing wallet…"}</span>
            </span>
          )}

          {authenticated && walletError && !walletLoading && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 sm:max-w-md">
              {walletError}
            </p>
          )}

          {walletReady && walletAddress && (
            <div className="flex min-h-[44px] w-full flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300 shadow-sm sm:min-h-0 sm:w-auto sm:rounded-full sm:py-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate font-mono">{shortAddress}</span>
              </div>
              <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[11px] text-emerald-300">
                Connected
              </span>
              {balanceLabel && (
                <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-200">
                  {balanceLabel}
                </span>
              )}
            </div>
          )}

          <button
            onClick={authenticated ? () => logout() : () => login()}
            disabled={!ready}
            className="btn-primary min-h-[44px] w-full shrink-0 justify-center sm:min-h-0 sm:w-auto"
          >
            <Wallet className="h-4 w-4" />
            {authenticated ? "Disconnect" : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="mx-auto mt-6 w-full max-w-6xl sm:mt-8">
        <StarknetAddressCard wallet={wallet} walletReady={walletReady} />
      </section>

      <section className="mx-auto mt-10 grid w-full max-w-6xl gap-8 lg:mt-14 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="card-inner h-full px-6 py-7 sm:px-8 sm:py-9 lg:px-10 lg:py-11">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary sm:text-[11px]">
              <Sparkles className="h-3 w-3" />
              Gas-free yield on Bitcoin
            </div>

            <h1 className="mt-5 text-balance text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl lg:text-5xl">
              Earn yield on Bitcoin —{" "}
              <span className="bg-gradient-to-r from-primary via-fuchsia-400 to-accent bg-clip-text text-transparent">
                gas-free on Starknet
              </span>
            </h1>

            <p className="mt-4 max-w-xl text-sm text-slate-300 sm:text-base">
              BTC Yield Vault abstracts bridges, swaps and yields into one tap. Deposit BTC,
              dollar-cost-average into yield strategies, and let Starknet handle gas behind
              the scenes.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={handlePrimaryAction}
                disabled={!ready}
                className="btn-primary text-sm sm:text-base"
              >
                {authenticated ? "Start earning yield" : "Connect to start"}
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                className="btn-outline text-xs sm:text-sm"
                onClick={() =>
                  toast("BTC Yield Vault", {
                    description: "Demo interface. Wire your own strategies under the hood."
                  })
                }
              >
                Learn how it works
              </button>
            </div>

            <div className="mt-8 grid gap-4 text-xs text-slate-400 sm:grid-cols-3 sm:text-[11px]">
              <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Backed by Starknet
                </p>
                <p className="mt-1.5 text-sm font-semibold text-slate-100">
                  L2 security, L1-grade Bitcoin exposure
                </p>
              </div>
              <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Gasless UX
                </p>
                <p className="mt-1.5 text-sm font-semibold text-slate-100">
                  Users never touch STRK — pay in BTC or stablecoins
                </p>
              </div>
              <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Smart automation
                </p>
                <p className="mt-1.5 text-sm font-semibold text-slate-100">
                  DCA and auto-lend rails ready for your strategies
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800/70 bg-slate-950/70 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Portfolio value</p>
                <p className="mt-1 text-xl font-semibold text-white">
                  ${portfolioValue.toLocaleString()}
                </p>
                <p className="text-xs text-emerald-300">+2.8% this week</p>
              </div>
              <div className="rounded-xl border border-slate-800/70 bg-slate-950/70 px-4 py-3">
                <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  Confidential routing
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {privateMode ? "Tongo private mode enabled" : "Public transaction mode"}
                </p>
                <p className="text-xs text-slate-400">
                  Toggle private mode globally for DCA and Vesu actions.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <DCAForm
            sdk={starkzap}
            walletAddress={walletAddress ?? undefined}
            isConnected={walletReady}
            privateMode={privateMode}
            onPrivateModeChange={setPrivateMode}
          />
          <AutoLendVault sdk={starkzap} isConnected={walletReady} privateMode={privateMode} />
        </div>
      </section>

      <section className="mx-auto mt-8 grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article className="card fade-up fade-up-delay-1">
          <div className="card-inner px-5 py-5 sm:px-6 sm:py-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Transaction history</h3>
              <Clock3 className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 space-y-2">
              {txHistory.length === 0 ? (
                <p className="rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-6 text-center text-sm text-slate-500">
                  No transactions yet
                </p>
              ) : (
                txHistory.map((tx, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"
                  >
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">
                      {JSON.stringify(tx, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </article>

        <article className="card fade-up fade-up-delay-2">
          <div className="card-inner px-5 py-5 sm:px-6 sm:py-6">
            <h3 className="text-base font-semibold text-white">Live yield calculator</h3>
            <p className="mt-1 text-xs text-slate-400">
              Simulated blended strategy returns across DCA + Vesu lending.
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs text-slate-400">If portfolio grows at 3.4% APR:</p>
              <p className="mt-1 text-lg font-semibold text-emerald-300">
                +${(portfolioValue * 0.034).toFixed(2)} / year
              </p>
              <button
                type="button"
                onClick={() => setPortfolioValue((v) => v + 500)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-primary"
              >
                Simulate +$500 capital
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </article>
      </section>

      <section className="mx-auto mt-8 w-full max-w-6xl">
        <article className="card">
          <div className="card-inner px-6 py-6 sm:px-8">
            <h3 className="text-lg font-semibold text-white">How it works</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-[11px] uppercase tracking-wide text-primary">Step 1</p>
                <p className="mt-1 text-sm font-semibold text-white">Connect and secure</p>
                <p className="mt-1 text-xs text-slate-400">
                  Login with Google or Email, then connect your StarkZap wallet in one click.
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-[11px] uppercase tracking-wide text-primary">Step 2</p>
                <p className="mt-1 text-sm font-semibold text-white">Choose strategy</p>
                <p className="mt-1 text-xs text-slate-400">
                  Configure DCA cadence and auto-lending with optional Tongo private mode.
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-[11px] uppercase tracking-wide text-primary">Step 3</p>
                <p className="mt-1 text-sm font-semibold text-white">Track and compound</p>
                <p className="mt-1 text-xs text-slate-400">
                  Monitor transaction history and projected yield as your vault compounds.
                </p>
              </div>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

