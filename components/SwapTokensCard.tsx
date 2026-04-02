"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Amount, type WalletInterface } from "starkzap";
import {
  type DashboardTokenSymbol,
  SEPOLIA_DASHBOARD_TOKENS
} from "@/lib/starkzap-sepolia";
import { withSponsoredFeeFallback } from "@/lib/starkzap-fee";

type TxPayload = {
  hash: string;
  type: "Swap";
  amountLabel: string;
};

type BalanceMap = Record<DashboardTokenSymbol, number>;

type Props = {
  wallet: WalletInterface;
  explorerBaseUrl: string;
  balances: BalanceMap;
  sponsoredFeesEnabled: boolean;
  onTransactionComplete?: (payload: TxPayload) => void;
};

const TOKEN_OPTIONS: DashboardTokenSymbol[] = ["USDC", "BTC", "STRK"];

export function SwapTokensCard({
  wallet,
  explorerBaseUrl,
  balances,
  sponsoredFeesEnabled,
  onTransactionComplete
}: Props) {
  const [tokenIn, setTokenIn] = useState<DashboardTokenSymbol>("USDC");
  const [tokenOut, setTokenOut] = useState<DashboardTokenSymbol>("BTC");
  const [amount, setAmount] = useState("");
  const [swapping, setSwapping] = useState(false);

  const inMeta = SEPOLIA_DASHBOARD_TOKENS[tokenIn];
  const maxIn = balances[tokenIn] ?? 0;

  const decimalsIn = useMemo(
    () => (tokenIn === "USDC" ? 2 : tokenIn === "STRK" ? 4 : 6),
    [tokenIn]
  );

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
  };

  const handleSwap = async () => {
    if (tokenIn === tokenOut) {
      toast.error("Pick two different tokens");
      return;
    }
    const parsed = Number(amount);
    if (!parsed || parsed <= 0 || !Number.isFinite(parsed)) {
      toast.error("Enter a valid amount");
      return;
    }
    if (parsed > maxIn) {
      toast.error("Insufficient balance", {
        description: `You have up to ${maxIn.toLocaleString(undefined, { maximumFractionDigits: decimalsIn })} ${tokenIn}.`
      });
      return;
    }

    setSwapping(true);
    try {
      const amountIn = Amount.parse(String(parsed), inMeta);
      const tx = await withSponsoredFeeFallback(sponsoredFeesEnabled, (feeMode) =>
        wallet.swap(
          {
            tokenIn: inMeta,
            tokenOut: SEPOLIA_DASHBOARD_TOKENS[tokenOut],
            amountIn,
            slippageBps: 100n
          },
          { feeMode }
        )
      );
      await tx.wait();
      const hash = tx.hash;
      const amountLabel = `${parsed.toLocaleString(undefined, { maximumFractionDigits: decimalsIn })} ${tokenIn} → ${tokenOut}`;
      toast.success("Swap submitted", {
        description: `${amountLabel} · 1% max slippage on Sepolia.${
          sponsoredFeesEnabled ? " Gasless when the paymaster accepts the tx." : ""
        }`
      });
      const explorerUrl = `${explorerBaseUrl}/tx/${hash}`;
      toast("View on Voyager", {
        description: explorerUrl,
        action: {
          label: "Open",
          onClick: () => window.open(explorerUrl, "_blank", "noopener,noreferrer")
        }
      });
      onTransactionComplete?.({ hash, type: "Swap", amountLabel });
      setAmount("");
    } catch (error) {
      console.error(error);
      toast.error("Swap failed", {
        description: error instanceof Error ? error.message : "Route or liquidity may be unavailable on Sepolia."
      });
    } finally {
      setSwapping(false);
    }
  };

  return (
    <article className="card h-full fade-up fade-up-delay-3">
      <div className="card-inner h-full px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-300">
              <ArrowDownUp className="h-3 w-3" />
              DEX
            </p>
            <h3 className="mt-3 text-lg font-semibold text-white">Swap tokens</h3>
            <p className="mt-1 text-xs text-slate-300">
              Uses <span className="font-medium text-slate-200">wallet.swap()</span> with AVNU routing (StarkZap v2) on
              Sepolia — 1% slippage (100 bps).
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-xs text-slate-400">From</p>
              <div className="flex flex-col gap-1.5">
                {TOKEN_OPTIONS.map((sym) => (
                  <button
                    key={`in-${sym}`}
                    type="button"
                    onClick={() => setTokenIn(sym)}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                      tokenIn === sym
                        ? "border-primary bg-primary/20 text-white"
                        : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-primary/50"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-slate-400">To</p>
              <div className="flex flex-col gap-1.5">
                {TOKEN_OPTIONS.map((sym) => (
                  <button
                    key={`out-${sym}`}
                    type="button"
                    onClick={() => setTokenOut(sym)}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                      tokenOut === sym
                        ? "border-accent bg-accent/15 text-white"
                        : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-accent/50"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={flip}
              className="rounded-full border border-slate-700 bg-slate-900/80 p-2 text-slate-300 transition hover:border-primary/50 hover:text-white"
              aria-label="Flip tokens"
            >
              <ArrowDownUp className="h-4 w-4" />
            </button>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-400">Amount in</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Available:{" "}
              <span className="text-slate-400">
                {maxIn.toLocaleString(undefined, { maximumFractionDigits: decimalsIn })} {tokenIn}
              </span>
            </p>
          </label>

          <button
            type="button"
            disabled={swapping || tokenIn === tokenOut}
            onClick={() => void handleSwap()}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {swapping ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Swapping…
              </>
            ) : (
              <>
                <ArrowDownUp className="h-4 w-4" />
                Swap
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
