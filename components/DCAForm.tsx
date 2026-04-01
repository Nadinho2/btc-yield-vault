"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Amount, type WalletInterface } from "starkzap";
import { SEPOLIA_USDC, SEPOLIA_WBTC } from "@/lib/starkzap-sepolia";

type TxPayload = {
  hash: string;
  type: "DCA";
  amountLabel: string;
};

type Props = {
  wallet: WalletInterface | null;
  walletAddress?: string;
  isConnected: boolean;
  explorerBaseUrl: string;
  balances: Record<Asset, number>;
  privateMode: boolean;
  onPrivateModeChange: (value: boolean) => void;
  /** After confirmed on-chain success: refresh balances/history + local history row */
  onTransactionComplete?: (payload: TxPayload) => void;
};

type Asset = "BTC" | "USDC";
type Frequency = "weekly" | "monthly";
type Duration = 3 | 6 | 12;

export function DCAForm({
  wallet,
  walletAddress,
  isConnected,
  explorerBaseUrl,
  balances,
  privateMode,
  onPrivateModeChange,
  onTransactionComplete
}: Props) {
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amount, setAmount] = useState<string>("");
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [duration, setDuration] = useState<Duration>(6);
  const [isCreating, setIsCreating] = useState(false);

  const maxBalance = useMemo(() => balances[asset] ?? 0, [asset, balances]);

  const estimatedExecutions = useMemo(() => {
    const interval = frequency === "weekly" ? 4 : 1;
    return duration * interval;
  }, [frequency, duration]);

  const perExecution = useMemo(() => {
    const input = Number(amount);
    if (!input || input <= 0) return 0;
    return input / estimatedExecutions;
  }, [amount, estimatedExecutions]);

  const handleCreatePlan = async () => {
    if (!isConnected || !walletAddress || !wallet) {
      toast.error("Connect your wallet first");
      return;
    }

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (parsedAmount > maxBalance) {
      toast.error("Insufficient balance", {
        description: `You only have ${maxBalance.toFixed(asset === "BTC" ? 6 : 2)} ${asset}.`
      });
      return;
    }

    const sellToken = asset === "USDC" ? SEPOLIA_USDC : SEPOLIA_WBTC;
    const buyToken = asset === "USDC" ? SEPOLIA_WBTC : SEPOLIA_USDC;
    const frequencyIso = frequency === "weekly" ? "P1W" : "P1M";

    setIsCreating(true);
    try {
      const sellAmount = Amount.parse(String(parsedAmount), sellToken);
      const sellAmountPerCycle = Amount.parse(String(perExecution), sellToken);

      const tx = await wallet.dca().create(
        {
          sellToken,
          buyToken,
          sellAmount,
          sellAmountPerCycle,
          frequency: frequencyIso
        },
        { feeMode: "sponsored" }
      );

      await tx.wait();

      const hash = tx.hash;
      const amountLabel = `${parsedAmount.toLocaleString(undefined, {
        maximumFractionDigits: asset === "USDC" ? 2 : 6
      })} ${asset}`;

      toast.success("DCA plan created (gasless)", {
        description: `${duration} months · ${frequency} · ${amountLabel} total budget on Sepolia. ${privateMode ? "Private mode on." : ""}`
      });

      const explorerUrl = `${explorerBaseUrl}/tx/${hash}`;
      toast("View on Starkscan", {
        description: explorerUrl,
        action: {
          label: "Open",
          onClick: () => window.open(explorerUrl, "_blank", "noopener,noreferrer")
        }
      });

      onTransactionComplete?.({ hash, type: "DCA", amountLabel });
    } catch (error) {
      console.error(error);
      toast.error("Failed to create DCA plan", {
        description: error instanceof Error ? error.message : "Please review your inputs and try again."
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <article className="card h-full fade-up">
      <div className="card-inner h-full px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
              <CalendarClock className="h-3 w-3" />
              Automated DCA
            </p>
            <h3 className="mt-3 text-lg font-semibold text-white">DCA into BTC or stables</h3>
            <p className="mt-1 text-xs text-slate-300">
              Uses <span className="font-medium text-slate-200">wallet.dca().create()</span> on StarkZap (gasless sponsored fees on Sepolia).
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <div>
            <p className="mb-1.5 text-xs text-slate-400">Sell asset</p>
            <div className="grid grid-cols-2 gap-2">
              {(["USDC", "BTC"] as Asset[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setAsset(opt)}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${
                    asset === opt
                      ? "border-primary bg-primary/20 text-white"
                      : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-primary/50"
                  }`}
                >
                  {opt === "BTC" ? "WBTC" : opt} → {opt === "USDC" ? "WBTC" : "USDC"}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              USDC sells into WBTC; WBTC sells into USDC. Uses Sepolia token presets from StarkZap.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs text-slate-400">Total budget</p>
              <p className="text-[11px] text-slate-500">
                Balance: {maxBalance.toLocaleString(undefined, { maximumFractionDigits: asset === "BTC" ? 6 : 2 })}{" "}
                {asset === "BTC" ? "WBTC" : asset}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Enter total ${asset === "BTC" ? "WBTC" : "USDC"} to sell over the plan`}
                inputMode="decimal"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={() => setAmount(String(maxBalance))}
                className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-primary"
              >
                Max
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1.5 text-xs text-slate-400">Frequency</p>
              <div className="grid grid-cols-2 gap-2">
                {(["weekly", "monthly"] as Frequency[]).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setFrequency(opt)}
                    className={`rounded-xl border px-2 py-2 text-xs capitalize transition ${
                      frequency === opt
                        ? "border-primary bg-primary/15 text-white"
                        : "border-slate-800 bg-slate-950/50 text-slate-300"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs text-slate-400">Duration</p>
              <div className="grid grid-cols-3 gap-2">
                {[3, 6, 12].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDuration(opt as Duration)}
                    className={`rounded-xl border px-2 py-2 text-xs transition ${
                      duration === opt
                        ? "border-primary bg-primary/15 text-white"
                        : "border-slate-800 bg-slate-950/50 text-slate-300"
                    }`}
                  >
                    {opt}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <EyeOff className="h-4 w-4 text-primary" />
              <span className="text-xs text-slate-200">Private mode (pricing hint)</span>
            </div>
            <input
              type="checkbox"
              checked={privateMode}
              onChange={(e) => onPrivateModeChange(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </label>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
            <p>
              Plan preview: {estimatedExecutions} cycles, ~{" "}
              <span className="font-semibold text-white">
                {perExecution ? perExecution.toFixed(6) : "0"}{" "}
                {asset === "BTC" ? "WBTC" : "USDC"}
              </span>{" "}
              per cycle.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={!isConnected || !wallet || isCreating || maxBalance <= 0}
          onClick={handleCreatePlan}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/40 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirming on Sepolia…
            </>
          ) : (
            <>
              Create DCA plan
              <ArrowUpRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </article>
  );
}
