"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Loader2,
  LogIn,
  Repeat2,
  Landmark,
  Zap,
  History,
  Coins
} from "lucide-react";
import { toast } from "sonner";
import { DCAForm } from "@/components/DCAForm";
import { AutoLendVault } from "@/components/AutoLendVault";
import { StarknetAddressCard } from "@/components/StarknetAddressCard";
import { getExplorerBaseUrl } from "@/hooks/useStarkzap";
import { FALLBACK_SUPPLY_APY, SEPOLIA_STRK, SEPOLIA_USDC, SEPOLIA_WBTC } from "@/lib/starkzap-sepolia";
import type { Token, WalletInterface } from "starkzap";

type WalletBalanceMap = {
  BTC: number;
  USDC: number;
  STRK: number;
};

type TxEntry = {
  hash: string;
  status: string;
  type: "DCA" | "Deposit" | "Swap";
  amountLabel: string;
  timestampLabel?: string;
};

function normalizeNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeTokenSymbol(input: unknown): "BTC" | "USDC" | "STRK" | null {
  if (typeof input !== "string") return null;
  const upper = input.toUpperCase();
  if (upper.includes("BTC")) return "BTC";
  if (upper.includes("USDC")) return "USDC";
  if (upper.includes("STRK")) return "STRK";
  return null;
}

function parseBalancesFromList(list: unknown[]): WalletBalanceMap {
  const next: WalletBalanceMap = { BTC: 0, USDC: 0, STRK: 0 };
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const symbol =
      normalizeTokenSymbol(row.symbol) ??
      normalizeTokenSymbol(row.asset) ??
      normalizeTokenSymbol(row.token);
    if (!symbol) continue;
    const amount =
      normalizeNumber(row.formatted) ??
      normalizeNumber(row.balance) ??
      normalizeNumber(row.amount) ??
      normalizeNumber(row.value);
    if (amount != null) next[symbol] = amount;
  }
  return next;
}

async function fetchRealBalances(sdk: unknown): Promise<WalletBalanceMap> {
  const s = sdk as {
    balance?: { getBalances?: () => Promise<unknown> };
    getTokenBalances?: () => Promise<unknown>;
  };
  if (typeof s.balance?.getBalances === "function") {
    const result = await s.balance.getBalances();
    if (Array.isArray(result)) return parseBalancesFromList(result);
    if (result && typeof result === "object") {
      const nested = (result as { balances?: unknown }).balances;
      if (Array.isArray(nested)) return parseBalancesFromList(nested);
    }
  }
  if (typeof s.getTokenBalances === "function") {
    const result = await s.getTokenBalances();
    if (Array.isArray(result)) return parseBalancesFromList(result);
    if (result && typeof result === "object") {
      const nested = (result as { balances?: unknown }).balances;
      if (Array.isArray(nested)) return parseBalancesFromList(nested);
    }
  }
  return { BTC: 0, USDC: 0, STRK: 0 };
}

/** Primary path: StarkZap v2 reads ERC-20 balances via the connected wallet (Sepolia). */
async function fetchBalancesFromWallet(wallet: WalletInterface): Promise<{
  balances: WalletBalanceMap;
  tokensReadOk: number;
}> {
  const balances: WalletBalanceMap = { BTC: 0, USDC: 0, STRK: 0 };
  const pairs: { key: keyof WalletBalanceMap; token: Token }[] = [
    { key: "BTC", token: SEPOLIA_WBTC },
    { key: "USDC", token: SEPOLIA_USDC },
    { key: "STRK", token: SEPOLIA_STRK }
  ];
  let tokensReadOk = 0;
  for (const { key, token } of pairs) {
    try {
      const amount = await wallet.balanceOf(token);
      const n = parseFloat(amount.toUnit());
      if (Number.isFinite(n) && n >= 0) {
        balances[key] = n;
        tokensReadOk += 1;
      }
    } catch {
      // Per-token failure must not crash the dashboard
    }
  }
  return { balances, tokensReadOk };
}

function mergeBalances(walletB: WalletBalanceMap, sdkB: WalletBalanceMap): WalletBalanceMap {
  return {
    BTC: walletB.BTC || sdkB.BTC,
    USDC: walletB.USDC || sdkB.USDC,
    STRK: walletB.STRK || sdkB.STRK
  };
}

function mergeTxHistories(local: TxEntry[], remote: TxEntry[]): TxEntry[] {
  const seen = new Set<string>();
  const out: TxEntry[] = [];
  for (const t of local) {
    if (seen.has(t.hash)) continue;
    seen.add(t.hash);
    out.push(t);
  }
  for (const t of remote) {
    if (seen.has(t.hash)) continue;
    seen.add(t.hash);
    out.push(t);
  }
  return out;
}

function normalizeHistory(raw: unknown[]): TxEntry[] {
  return raw
    .map((item): TxEntry | null => {
      if (!item || typeof item !== "object") return null;
      const tx = item as Record<string, unknown>;
      const hashLike = tx.txHash ?? tx.hash ?? tx.transactionHash ?? tx.id;
      if (typeof hashLike !== "string" || hashLike.length === 0) return null;
      const status = typeof tx.status === "string" ? tx.status : "submitted";
      const typeRaw =
        typeof tx.type === "string"
          ? tx.type
          : typeof tx.action === "string"
            ? tx.action
            : "swap";
      const upperType = typeRaw.toUpperCase();
      const type: "DCA" | "Deposit" | "Swap" = upperType.includes("DCA")
        ? "DCA"
        : upperType.includes("DEPOSIT") || upperType.includes("LEND")
          ? "Deposit"
          : "Swap";
      const amountValue =
        normalizeNumber(tx.amount) ??
        normalizeNumber(tx.value) ??
        normalizeNumber(tx.quantity) ??
        0;
      const amountAsset =
        normalizeTokenSymbol(tx.asset) ??
        normalizeTokenSymbol(tx.symbol) ??
        normalizeTokenSymbol(tx.token) ??
        "BTC";
      const amountLabel = `${amountValue.toLocaleString(undefined, {
        maximumFractionDigits: amountAsset === "USDC" ? 2 : 6
      })} ${amountAsset}`;
      const timestampRaw = tx.timestamp ?? tx.createdAt ?? tx.time;
      const timestamp = normalizeNumber(timestampRaw);
      const timestampLabel =
        timestamp != null ? new Date(timestamp > 10 ** 12 ? timestamp : timestamp * 1000).toLocaleString() : undefined;
      return { hash: hashLike, status, type, amountLabel, timestampLabel };
    })
    .filter((v): v is TxEntry => v !== null);
}

export default function HomePage() {
  const network = "sepolia";
  const {
    sdk: starkzap,
    address: walletAddress,
    balancePreview,
    walletReady,
    walletLoading,
    walletStatusText,
    walletError,
    wallet,
    connectStarkWallet,
    exportPrivateKey
  } = useStarkzapWallet(network);
  const { ready, authenticated, login, logout } = usePrivy();
  const [privateMode, setPrivateMode] = useState(true);
  const [balances, setBalances] = useState<WalletBalanceMap>({ BTC: 0, USDC: 0, STRK: 0 });
  const [balanceReadIssue, setBalanceReadIssue] = useState(false);
  const [localTxHistory, setLocalTxHistory] = useState<TxEntry[]>([]);
  const [remoteTxHistory, setRemoteTxHistory] = useState<TxEntry[]>([]);
  const didToastConnected = useRef(false);
  const strategiesRef = useRef<HTMLDivElement | null>(null);
  const howItWorksRef = useRef<HTMLElement | null>(null);
  const explorerBaseUrl = useMemo(() => getExplorerBaseUrl(network), [network]);
  const [txRefreshTick, setTxRefreshTick] = useState(0);

  const displayBalances = useMemo(
    () => (walletReady && wallet ? balances : { BTC: 0, USDC: 0, STRK: 0 }),
    [walletReady, wallet, balances]
  );
  const displayLocalTxHistory = useMemo(
    () => (authenticated && walletReady && wallet ? localTxHistory : []),
    [authenticated, walletReady, wallet, localTxHistory]
  );
  const displayRemoteTxHistory = useMemo(
    () => (walletReady && wallet ? remoteTxHistory : []),
    [walletReady, wallet, remoteTxHistory]
  );

  const formattedBalances = useMemo(
    () => ({
      USDC: `${displayBalances.USDC.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
      BTC: `${displayBalances.BTC.toLocaleString(undefined, { maximumFractionDigits: 6 })} BTC`,
      STRK: `${displayBalances.STRK.toLocaleString(undefined, { maximumFractionDigits: 4 })} STRK`
    }),
    [displayBalances]
  );

  useEffect(() => {
    if (walletReady && !didToastConnected.current) {
      didToastConnected.current = true;
      toast.success("Wallet connected", {
        description: "Your sepolia Starknet wallet is ready."
      });
    }
    if (!authenticated) {
      didToastConnected.current = false;
    }
  }, [walletReady, authenticated]);

  useEffect(() => {
    if (!walletReady || !wallet) return;
    let cancelled = false;

    const run = async () => {
      try {
        const { balances: walletB, tokensReadOk } = await fetchBalancesFromWallet(wallet);
        if (cancelled) return;
        setBalanceReadIssue(tokensReadOk === 0);
        let merged = walletB;
        try {
          const sdkB = await fetchRealBalances(starkzap);
          if (!cancelled) merged = mergeBalances(walletB, sdkB);
        } catch {
          // SDK balance helpers are optional on StarkZap; wallet path is canonical
        }
        if (!cancelled) setBalances(merged);
      } catch {
        if (cancelled) return;
        setBalanceReadIssue(true);
        try {
          const sdkB = await fetchRealBalances(starkzap);
          if (!cancelled) setBalances(sdkB);
        } catch {
          if (!cancelled) setBalances({ BTC: 0, USDC: 0, STRK: 0 });
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [walletReady, wallet, starkzap, txRefreshTick]);

  useEffect(() => {
    if (!walletReady || !wallet) return;
    let cancelled = false;
    const sdkAny = starkzap as {
      transaction?: { getHistory?: () => Promise<unknown> };
      getRecentTransactions?: () => Promise<unknown>;
    };

    const run = async () => {
      try {
        if (typeof sdkAny.transaction?.getHistory === "function") {
          const h = await sdkAny.transaction.getHistory();
          if (cancelled) return;
          if (Array.isArray(h)) {
            setRemoteTxHistory(normalizeHistory(h));
          } else {
            setRemoteTxHistory([]);
          }
          return;
        }
        if (typeof sdkAny.getRecentTransactions === "function") {
          const h = await sdkAny.getRecentTransactions();
          if (cancelled) return;
          if (Array.isArray(h)) {
            setRemoteTxHistory(normalizeHistory(h));
          } else {
            setRemoteTxHistory([]);
          }
          return;
        }
        if (!cancelled) setRemoteTxHistory([]);
      } catch {
        if (!cancelled) setRemoteTxHistory([]);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [walletReady, wallet, starkzap, txRefreshTick]);

  const visibleTxHistory = mergeTxHistories(displayLocalTxHistory, displayRemoteTxHistory);

  const shortAddress =
    walletAddress && `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;

  const balanceLabel = useMemo(() => {
    if (!balancePreview) return undefined;
    return balancePreview.includes("BTC") ? balancePreview : `${balancePreview} (balance)`;
  }, [balancePreview]);
  const portfolioValue = displayBalances.USDC;

  const handleTransactionComplete = useCallback(
    (payload: { hash: string; type: TxEntry["type"]; amountLabel: string }) => {
      setLocalTxHistory((prev) => [
        {
          hash: payload.hash,
          status: "success",
          type: payload.type,
          amountLabel: payload.amountLabel,
          timestampLabel: new Date().toLocaleString()
        },
        ...prev.filter((t) => t.hash !== payload.hash)
      ]);
      setTxRefreshTick((v) => v + 1);
    },
    []
  );

  const scrollToStrategies = () => {
    strategiesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToHowItWorks = () => {
    howItWorksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handlePrimaryAction = () => {
    if (!ready) return;
    if (!authenticated) {
      login();
      return;
    }
    if (!walletReady) {
      toast.message("Wallet provisioning", {
        description: "Your Starknet embedded wallet is loading in the header bar."
      });
      return;
    }
    scrollToStrategies();
    toast.success("Let’s earn", {
      description: "Configure DCA or Vesu below — gasless on Sepolia."
    });
  };

  const yieldPreview = useMemo(
    () => ({
      usdcYear: displayBalances.USDC * (FALLBACK_SUPPLY_APY.USDC / 100),
      btcYear: displayBalances.BTC * (FALLBACK_SUPPLY_APY.BTC / 100)
    }),
    [displayBalances.USDC, displayBalances.BTC]
  );

  const handleLogout = () => {
    setLocalTxHistory([]);
    void logout();
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
                SEPOLIA
              </span>
            </span>
            <span className="text-xs text-slate-400">
              Gasless yield on Bitcoin, powered by Starknet
            </span>
            <span className="text-[11px] text-slate-500">Gasless powered by Cartridge</span>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <span className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 sm:rounded-full sm:py-1.5">
            Network: Sepolia
          </span>

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
              <span className="min-w-0 break-words">
                {walletStatusText ?? "Creating your Starknet wallet... (10-25 seconds)"}
              </span>
            </span>
          )}

          {authenticated && walletError && !walletLoading && (
            <div className="flex flex-col gap-2 sm:max-w-md">
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                {walletError}
              </p>
              <button
                type="button"
                onClick={() => void connectStarkWallet()}
                className="inline-flex items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/20"
              >
                Retry
              </button>
            </div>
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
            onClick={authenticated ? () => handleLogout() : () => login()}
            disabled={!ready}
            className="btn-primary min-h-[44px] w-full shrink-0 justify-center sm:min-h-0 sm:w-auto"
          >
            <Wallet className="h-4 w-4" />
            {authenticated ? "Disconnect" : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="mx-auto mt-6 w-full max-w-6xl sm:mt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <StarknetAddressCard
              wallet={wallet}
              walletReady={walletReady}
              network={network}
              explorerBaseUrl={explorerBaseUrl}
            />
          </div>
          {walletReady && !walletLoading && (
            <button
              type="button"
              onClick={() => void exportPrivateKey()}
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-amber-600/50 bg-amber-950/40 px-3 py-2 text-left text-xs font-semibold text-amber-100 shadow-sm transition hover:border-red-500/60 hover:bg-amber-950/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 sm:max-w-[220px]"
            >
              ⚠️ Export Private Key (Backup)
            </button>
          )}
        </div>
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
                onClick={scrollToHowItWorks}
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
                <p className="text-xs text-emerald-300">
                  Live Sepolia balances (WBTC, USDC, STRK) via your connected wallet
                </p>
                <div className="mt-2 space-y-1 text-[11px] text-slate-300">
                  <p>{formattedBalances.USDC}</p>
                  <p>{formattedBalances.BTC}</p>
                  <p>{formattedBalances.STRK}</p>
                </div>
                {walletReady && balanceReadIssue && (
                  <div className="mt-3 flex gap-2 rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-left">
                    <Coins className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/90" aria-hidden />
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      We couldn&apos;t read token balances from the RPC yet (account may still be deploying). Balances
                      usually appear after the wallet is fully ready—try refreshing in a moment or fund the address on
                      Sepolia.
                    </p>
                  </div>
                )}
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

        <div ref={strategiesRef} id="earn-strategies" className="scroll-mt-24 grid gap-4">
          <DCAForm
            wallet={wallet}
            walletAddress={walletAddress ?? undefined}
            isConnected={walletReady}
            explorerBaseUrl={explorerBaseUrl}
            balances={displayBalances}
            privateMode={privateMode}
            onPrivateModeChange={setPrivateMode}
            onTransactionComplete={handleTransactionComplete}
          />
          <AutoLendVault
            wallet={wallet}
            isConnected={walletReady}
            explorerBaseUrl={explorerBaseUrl}
            balances={{ BTC: displayBalances.BTC, USDC: displayBalances.USDC }}
            privateMode={privateMode}
            refreshKey={txRefreshTick}
            onTransactionComplete={handleTransactionComplete}
          />
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
              {!walletReady ? (
                <p className="rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-6 text-center text-sm text-slate-500">
                  Connect your wallet to load history
                </p>
              ) : visibleTxHistory.length === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-950/80 to-slate-900/40 px-5 py-10 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25">
                    <History className="h-7 w-7 text-primary" aria-hidden />
                  </div>
                  <p className="mt-4 max-w-sm text-sm font-medium text-slate-200">
                    No transactions yet. Your history will appear after your first DCA or Vesu deposit.
                  </p>
                  <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500">
                    On-chain activity from StarkZap will merge here when the history API is available for your session.
                  </p>
                </div>
              ) : (
                visibleTxHistory.map((tx) => (
                  <div
                    key={tx.hash}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold capitalize text-slate-100">{tx.type}</p>
                      <p className="text-[11px] uppercase text-slate-400">{tx.status}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-300">{tx.amountLabel}</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-400">{tx.hash}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-[11px] text-slate-500">{tx.timestampLabel ?? "Pending timestamp"}</p>
                      <a
                        href={`${explorerBaseUrl}/tx/${tx.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary hover:underline"
                      >
                        View tx
                      </a>
                    </div>
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
              Illustrative supply yield at {FALLBACK_SUPPLY_APY.USDC}% (USDC) and {FALLBACK_SUPPLY_APY.BTC}% (WBTC) on
              Sepolia.
            </p>
            <div className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div>
                <p className="text-xs text-slate-400">USDC (stable)</p>
                <p className="mt-0.5 text-lg font-semibold text-emerald-300">
                  +{yieldPreview.usdcYear.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC / year
                </p>
              </div>
              <div className="border-t border-slate-800/80 pt-3">
                <p className="text-xs text-slate-400">WBTC</p>
                <p className="mt-0.5 text-lg font-semibold text-emerald-300">
                  +{yieldPreview.btcYear.toLocaleString(undefined, { maximumFractionDigits: 8 })} WBTC / year
                </p>
              </div>
              <p className="text-[11px] text-slate-500">Network: Sepolia · gasless via Cartridge paymaster</p>
            </div>
          </div>
        </article>
      </section>

      <section
        ref={howItWorksRef}
        id="how-it-works"
        className="mx-auto mt-6 w-full max-w-6xl scroll-mt-24"
      >
        <article className="card overflow-hidden border border-slate-800/80 bg-gradient-to-br from-slate-950/90 via-slate-950/70 to-primary/5">
          <div className="card-inner px-6 py-8 sm:px-10 sm:py-10">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/90">How it works</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">Three steps. One gasless flow.</h3>
                <p className="mt-2 max-w-2xl text-sm text-slate-400">
                  Built on StarkZap v2 + Privy — Sepolia testnet, production-ready patterns for your bounty demo.
                </p>
              </div>
              <div className="mt-4 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-medium text-primary sm:mt-0">
                Sepolia testnet
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="group relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/40 p-4 shadow-lg shadow-black/20 transition hover:border-primary/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/20 ring-1 ring-primary/30">
                  <LogIn className="h-5 w-5 text-primary" />
                </div>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Step 1</p>
                <p className="mt-1 text-base font-semibold text-white">Connect in seconds</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Sign in with Google or email. Privy creates a Starknet embedded wallet, provisioned gasless via{" "}
                  <span className="text-slate-300">Cartridge</span> on Sepolia.
                </p>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/40 p-4 shadow-lg shadow-black/20 transition hover:border-primary/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/20 to-primary/25 ring-1 ring-fuchsia-500/30">
                  <Repeat2 className="h-5 w-5 text-fuchsia-300" />
                </div>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Step 2</p>
                <p className="mt-1 text-base font-semibold text-white">DCA into BTC or USDC</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Create recurring orders with <span className="text-slate-300">wallet.dca().create()</span> — sell USDC
                  into WBTC or rotate WBTC into USDC with your chosen cadence.
                </p>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/40 p-4 shadow-lg shadow-black/20 transition hover:border-primary/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-primary/25 ring-1 ring-emerald-500/30">
                  <Landmark className="h-5 w-5 text-emerald-300" />
                </div>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Step 3</p>
                <p className="mt-1 text-base font-semibold text-white">Earn on Vesu</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Deposit WBTC or USDC into Vesu lending with <span className="text-slate-300">wallet.lending().deposit()</span> on-chain
                  — real markets, supply APY, and full explorer traceability.
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/50 px-4 py-4 text-center text-xs text-slate-500">
              <Zap className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Tip: use <span className="font-medium text-slate-300">Start earning yield</span> to jump to DCA &amp; Vesu
                when your wallet is ready.
              </span>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

