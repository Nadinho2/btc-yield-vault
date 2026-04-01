"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Loader2, TrendingUp, Wallet2 } from "lucide-react";
import { toast } from "sonner";
import { Amount, type WalletInterface } from "starkzap";
import { FALLBACK_SUPPLY_APY, SEPOLIA_USDC, SEPOLIA_WBTC } from "@/lib/starkzap-sepolia";

type DepositAsset = "BTC" | "USDC";

type TxPayload = {
  hash: string;
  type: "Deposit";
  amountLabel: string;
};

type Props = {
  wallet: WalletInterface | null;
  isConnected: boolean;
  explorerBaseUrl: string;
  balances: {
    BTC: number;
    USDC: number;
  };
  privateMode: boolean;
  onTransactionComplete?: (payload: TxPayload) => void;
  /** Bump after any tx so we refetch Vesu positions & markets */
  refreshKey: number;
};

function amountFromStats(apy: { toUnit: () => string } | undefined): number | null {
  if (!apy) return null;
  const n = parseFloat(apy.toUnit());
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
}

export function AutoLendVault({
  wallet,
  isConnected,
  explorerBaseUrl,
  balances,
  privateMode,
  onTransactionComplete,
  refreshKey
}: Props) {
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [depositAsset, setDepositAsset] = useState<DepositAsset>("BTC");
  const [depositAmount, setDepositAmount] = useState<string>("0.01");
  const [apyPct, setApyPct] = useState<{ btc: number; usdc: number }>({
    btc: FALLBACK_SUPPLY_APY.BTC,
    usdc: FALLBACK_SUPPLY_APY.USDC
  });
  const [supplied, setSupplied] = useState({ btc: 0, usdc: 0 });

  const token = depositAsset === "BTC" ? SEPOLIA_WBTC : SEPOLIA_USDC;
  const activeApr = depositAsset === "BTC" ? apyPct.btc : apyPct.usdc;

  const parsedDeposit = Number(depositAmount);
  const maxSpend = depositAsset === "BTC" ? balances.BTC : balances.USDC;

  const loadMarkets = useCallback(async () => {
    if (!wallet) return;
    try {
      const markets = await wallet.lending().getMarkets();
      let btc: number = FALLBACK_SUPPLY_APY.BTC;
      let usdc: number = FALLBACK_SUPPLY_APY.USDC;
      for (const m of markets) {
        const sym = (m.asset.symbol ?? "").toUpperCase();
        const pct = amountFromStats(m.stats?.supplyApy);
        if (pct == null) continue;
        if (sym.includes("WBTC") || sym === "BTC" || sym.includes("XBTC")) btc = pct;
        if (sym.includes("USDC")) usdc = pct;
      }
      setApyPct({ btc, usdc });
    } catch {
      setApyPct({ btc: FALLBACK_SUPPLY_APY.BTC, usdc: FALLBACK_SUPPLY_APY.USDC });
    }
  }, [wallet]);

  const loadPositions = useCallback(async () => {
    if (!wallet) return;
    try {
      const positions = await wallet.lending().getPositions({ user: wallet.address });
      let btc = 0;
      let usdc = 0;
      for (const p of positions) {
        if (p.type !== "earn") continue;
        const t = p.collateral.token;
        const raw = p.collateral.amount;
        const sym = (t.symbol ?? "").toUpperCase();
        const human = parseFloat(Amount.fromRaw(raw, t).toUnit());
        if (!Number.isFinite(human)) continue;
        if (sym.includes("WBTC") || sym.includes("BTC")) btc += human;
        if (sym.includes("USDC")) usdc += human;
      }
      setSupplied({ btc, usdc });
    } catch {
      setSupplied({ btc: 0, usdc: 0 });
    }
  }, [wallet]);

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets, refreshKey]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions, refreshKey]);

  const projected6m = useMemo(
    () => (Number.isFinite(parsedDeposit) && parsedDeposit > 0 ? (parsedDeposit * (activeApr / 100)) * 0.5 : 0),
    [parsedDeposit, activeApr]
  );
  const projected12m = useMemo(
    () => (Number.isFinite(parsedDeposit) && parsedDeposit > 0 ? parsedDeposit * (activeApr / 100) : 0),
    [parsedDeposit, activeApr]
  );

  const handleDeposit = async () => {
    if (!isConnected || !wallet) {
      toast.error("Connect wallet first");
      return;
    }
    if (!parsedDeposit || parsedDeposit <= 0) {
      toast.error("Enter a valid deposit amount");
      return;
    }
    if (parsedDeposit > maxSpend) {
      toast.error("Insufficient balance", {
        description: `Available: ${maxSpend.toFixed(depositAsset === "BTC" ? 6 : 2)} ${depositAsset === "BTC" ? "WBTC" : "USDC"}`
      });
      return;
    }

    setIsDepositing(true);
    try {
      const amount = Amount.parse(String(parsedDeposit), token);
      const tx = await wallet.lending().deposit(
        {
          token,
          amount
        },
        { feeMode: "sponsored" }
      );
      await tx.wait();

      const hash = tx.hash;
      const unit = depositAsset === "BTC" ? "WBTC" : "USDC";
      const amountLabel = `${parsedDeposit.toLocaleString(undefined, {
        maximumFractionDigits: depositAsset === "BTC" ? 6 : 2
      })} ${unit}`;

      toast.success("Deposited to Vesu (gasless)", {
        description: `~${activeApr.toFixed(2)}% supply APY on Sepolia${privateMode ? " · private routing preference saved" : ""}.`
      });
      toast("View on Starkscan", {
        description: `${explorerBaseUrl}/tx/${hash}`,
        action: {
          label: "Open",
          onClick: () => window.open(`${explorerBaseUrl}/tx/${hash}`, "_blank", "noopener,noreferrer")
        }
      });

      onTransactionComplete?.({ hash, type: "Deposit", amountLabel });
      void loadPositions();
    } catch (error) {
      console.error(error);
      toast.error("Deposit failed", {
        description: error instanceof Error ? error.message : "Try again in a moment."
      });
    } finally {
      setIsDepositing(false);
    }
  };

  const withdrawAsset = async (asset: DepositAsset) => {
    if (!isConnected || !wallet) return;
    const amt = asset === "BTC" ? supplied.btc : supplied.usdc;
    if (amt <= 0) {
      toast.error("No Vesu position for this asset");
      return;
    }
    const t = asset === "BTC" ? SEPOLIA_WBTC : SEPOLIA_USDC;
    setIsWithdrawing(true);
    try {
      const tx = await wallet.lending().withdraw(
        {
          token: t,
          amount: Amount.parse(String(amt), t)
        },
        { feeMode: "sponsored" }
      );
      await tx.wait();
      const hash = tx.hash;
      toast.success("Withdrawn from Vesu", {
        description: "Funds returned to your wallet."
      });
      toast("View on Starkscan", {
        description: `${explorerBaseUrl}/tx/${hash}`,
        action: {
          label: "Open",
          onClick: () => window.open(`${explorerBaseUrl}/tx/${hash}`, "_blank", "noopener,noreferrer")
        }
      });
      onTransactionComplete?.({
        hash,
        type: "Deposit",
        amountLabel: `Withdraw ${amt.toFixed(asset === "BTC" ? 6 : 2)} ${asset === "BTC" ? "WBTC" : "USDC"}`
      });
      void loadPositions();
    } catch (error) {
      console.error(error);
      toast.error("Withdraw failed", {
        description: error instanceof Error ? error.message : "Please retry shortly."
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <article className="card h-full fade-up fade-up-delay-1">
      <div className="card-inner h-full px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2 py-1 text-[11px] font-medium text-primary-foreground/90">
              <TrendingUp className="h-3 w-3 text-accent" />
              Vesu lending
            </p>
            <h3 className="mt-3 text-lg font-semibold text-white">Auto-lend & earn</h3>
            <p className="mt-1 text-xs text-slate-300">
              Calls <span className="font-medium text-slate-200">wallet.lending().deposit()</span> on StarkZap (sponsored fees, Sepolia).
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] text-emerald-300/90">
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 font-semibold">
              WBTC ~{apyPct.btc.toFixed(2)}% APY
            </span>
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 font-semibold text-sky-200">
              USDC ~{apyPct.usdc.toFixed(2)}% APY
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Wallet balances</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-500">WBTC</p>
                <p className="font-semibold tabular-nums text-white">
                  {balances.BTC.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </p>
              </div>
              <div>
                <p className="text-slate-500">USDC</p>
                <p className="font-semibold tabular-nums text-white">
                  {balances.USDC.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Supplied to Vesu (earn)</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-500">WBTC</p>
                <p className="font-semibold tabular-nums text-emerald-300">
                  {supplied.btc.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </p>
              </div>
              <div>
                <p className="text-slate-500">USDC</p>
                <p className="font-semibold tabular-nums text-emerald-300">
                  {supplied.usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs text-slate-400">Deposit asset</p>
            <div className="grid grid-cols-2 gap-2">
              {(["BTC", "USDC"] as DepositAsset[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setDepositAsset(a)}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${
                    depositAsset === a
                      ? "border-primary bg-primary/20 text-white"
                      : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-primary/50"
                  }`}
                >
                  {a === "BTC" ? "WBTC" : "USDC"}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Yield preview (supply APY)</p>
            <p className="mt-1 text-xs text-slate-500">
              Live estimate from <span className="text-slate-400">lending.getMarkets()</span> with Sepolia fallbacks.
            </p>
            <label className="mt-3 block text-xs text-slate-300">
              Amount ({depositAsset === "BTC" ? "WBTC" : "USDC"})
              <input
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white outline-none"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                <p className="text-slate-400">~6 months ({activeApr.toFixed(2)}% supply APY)</p>
                <p className="font-semibold text-emerald-300">
                  +
                  {depositAsset === "BTC"
                    ? `${projected6m.toFixed(8)} WBTC`
                    : `${(parsedDeposit * (activeApr / 100) * 0.5).toFixed(2)} USDC`}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                <p className="text-slate-400">~12 months</p>
                <p className="font-semibold text-emerald-300">
                  +
                  {depositAsset === "BTC"
                    ? `${projected12m.toFixed(8)} WBTC`
                    : `${(parsedDeposit * (activeApr / 100)).toFixed(2)} USDC`}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleDeposit}
            disabled={!isConnected || !wallet || isDepositing || isWithdrawing || maxSpend <= 0}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/40 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDepositing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing deposit…
              </>
            ) : (
              <>
                <Coins className="h-4 w-4" />
                Deposit to Vesu &amp; earn yield
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void withdrawAsset(depositAsset)}
            disabled={
              !isConnected ||
              !wallet ||
              isDepositing ||
              isWithdrawing ||
              (depositAsset === "BTC" ? supplied.btc : supplied.usdc) <= 0
            }
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isWithdrawing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Withdrawing…
              </>
            ) : (
              <>
                <Wallet2 className="h-4 w-4" />
                Withdraw {depositAsset === "BTC" ? "WBTC" : "USDC"}
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
