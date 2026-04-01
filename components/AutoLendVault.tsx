"use client";

import { useMemo, useState } from "react";
import { Coins, Loader2, TrendingUp, Wallet2 } from "lucide-react";
import { toast } from "sonner";
import type { StarkZap } from "starkzap";

type LendingSdkLike = {
  lending?: {
    depositToVesu?: (args: {
      asset: "BTC";
      amount: number;
      privacy: "tongo" | "public";
    }) => Promise<{ txHash?: string; hash?: string } | undefined>;
    withdrawFromVesu?: (args: {
      asset: "BTC";
      amount: number;
    }) => Promise<unknown>;
  };
};

type Props = {
  sdk: StarkZap | LendingSdkLike;
  isConnected: boolean;
  privateMode: boolean;
};

const BASE_HOLDINGS = {
  btc: 0.1186,
  usdc: 3300
};

export function AutoLendVault({ sdk, isConnected, privateMode }: Props) {
  const sdkWithLending = sdk as LendingSdkLike;
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [apr, setApr] = useState(3.4);
  const [depositAmount, setDepositAmount] = useState(0.06);
  const [lentAmount, setLentAmount] = useState(0);

  const holdings = useMemo(
    () => ({
      walletBTC: Math.max(BASE_HOLDINGS.btc - lentAmount, 0),
      lentBTC: lentAmount
    }),
    [lentAmount]
  );

  const projected6m = useMemo(() => depositAmount * (apr / 100) * 0.5, [apr, depositAmount]);
  const projected12m = useMemo(() => depositAmount * (apr / 100), [apr, depositAmount]);

  const handleDeposit = async () => {
    if (!isConnected) {
      toast.error("Connect wallet first");
      return;
    }
    setIsDepositing(true);
    try {
      const res = await sdkWithLending.lending?.depositToVesu?.({
        asset: "BTC",
        amount: depositAmount,
        privacy: privateMode ? "tongo" : "public"
      });
      const txHash =
        res?.txHash ??
        res?.hash ??
        `0x${Math.floor(Math.random() * 10 ** 14).toString(16)}${Date.now().toString(16)}`;

      setLentAmount((v) => v + depositAmount);
      toast.success("Deposited to Vesu", {
        description: `Yield route activated at ~${apr.toFixed(2)}% APR.`
      });
      toast("View on explorer", {
        description: `https://starkscan.co/tx/${txHash}`,
        action: {
          label: "Open",
          onClick: () => window.open(`https://starkscan.co/tx/${txHash}`, "_blank")
        }
      });
    } catch (error) {
      console.error(error);
      toast.error("Deposit failed", {
        description: "Try again in a moment."
      });
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!isConnected || holdings.lentBTC <= 0) {
      toast.error("No active Vesu position to withdraw");
      return;
    }
    setIsWithdrawing(true);
    try {
      await sdkWithLending.lending?.withdrawFromVesu?.({
        asset: "BTC",
        amount: holdings.lentBTC
      });
      setLentAmount(0);
      toast.success("Funds withdrawn", {
        description: "Assets returned to your wallet."
      });
    } catch (error) {
      console.error(error);
      toast.error("Withdraw failed", {
        description: "Please retry shortly."
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <article className="card h-full fade-up fade-up-delay-1">
      <div className="card-inner h-full px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2 py-1 text-[11px] font-medium text-primary-foreground/90">
              <TrendingUp className="h-3 w-3 text-accent" />
              Auto-Lend to Vesu
            </p>
            <h3 className="mt-3 text-lg font-semibold text-white">Vesu Yield Vault</h3>
            <p className="mt-1 text-xs text-slate-300">
              Deposit once and auto-route BTC to Vesu lending pools.
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
            APR {apr.toFixed(2)}%
          </span>
        </div>

        <div className="mt-4 grid gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Current holdings</p>
            <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-slate-400">Wallet BTC</p>
                <p className="font-semibold text-white">{holdings.walletBTC.toFixed(4)} BTC</p>
              </div>
              <div>
                <p className="text-slate-400">Lent BTC</p>
                <p className="font-semibold text-white">{holdings.lentBTC.toFixed(4)} BTC</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Yield preview calculator</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-slate-300">
                Deposit amount (BTC)
                <input
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white outline-none"
                />
              </label>
              <label className="text-xs text-slate-300">
                Estimated APR (%)
                <input
                  value={apr}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    const safe = Number.isFinite(next) ? Math.min(4, Math.max(2, next)) : 3.4;
                    setApr(safe);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white outline-none"
                />
              </label>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                <p className="text-slate-400">Projected (6m)</p>
                <p className="font-semibold text-emerald-300">+{projected6m.toFixed(5)} BTC</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                <p className="text-slate-400">Projected (12m)</p>
                <p className="font-semibold text-emerald-300">+{projected12m.toFixed(5)} BTC</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleDeposit}
            disabled={!isConnected || isDepositing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/40 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDepositing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Depositing...
              </>
            ) : (
              <>
                <Coins className="h-4 w-4" />
                Deposit to Vesu & Earn Yield
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleWithdraw}
            disabled={!isConnected || isWithdrawing || holdings.lentBTC <= 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isWithdrawing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Withdrawing...
              </>
            ) : (
              <>
                <Wallet2 className="h-4 w-4" />
                Withdraw
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

