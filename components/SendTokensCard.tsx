"use client";

import { useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Amount, type Address, type WalletInterface } from "starkzap";
import {
  type DashboardTokenSymbol,
  SEPOLIA_DASHBOARD_TOKENS
} from "@/lib/starkzap-sepolia";
import { withSponsoredFeeFallback } from "@/lib/starkzap-fee";

type TxPayload = {
  hash: string;
  type: "Send";
  amountLabel: string;
};

type BalanceMap = Record<DashboardTokenSymbol, number>;

type Props = {
  wallet: WalletInterface;
  explorerBaseUrl: string;
  balances: BalanceMap;
  sponsoredFeesEnabled: boolean;
  selfAddress: string;
  onTransactionComplete?: (payload: TxPayload) => void;
};

const TOKEN_OPTIONS: DashboardTokenSymbol[] = ["USDC", "BTC", "STRK"];

function isStarknetAddress(value: string): boolean {
  const v = value.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(v)) return false;
  const hexLen = v.length - 2;
  return hexLen >= 56 && hexLen <= 64;
}

export function SendTokensCard({
  wallet,
  explorerBaseUrl,
  balances,
  sponsoredFeesEnabled,
  selfAddress,
  onTransactionComplete
}: Props) {
  const [token, setToken] = useState<DashboardTokenSymbol>("USDC");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);

  const tokenMeta = SEPOLIA_DASHBOARD_TOKENS[token];
  const maxBalance = balances[token] ?? 0;

  const decimalsHint = useMemo(
    () => (token === "USDC" ? 2 : token === "STRK" ? 4 : 6),
    [token]
  );

  const handleSend = async () => {
    const parsed = Number(amount);
    if (!parsed || parsed <= 0 || !Number.isFinite(parsed)) {
      toast.error("Enter a valid amount");
      return;
    }
    if (parsed > maxBalance) {
      toast.error("Insufficient balance", {
        description: `You have up to ${maxBalance.toLocaleString(undefined, { maximumFractionDigits: decimalsHint })} ${token}.`
      });
      return;
    }
    const to = recipient.trim();
    if (!isStarknetAddress(to)) {
      toast.error("Invalid recipient", {
        description: "Use a Starknet address: 0x followed by 56–64 hex characters."
      });
      return;
    }
    const self = selfAddress.trim().toLowerCase();
    if (to.toLowerCase() === self) {
      toast.error("Invalid recipient", { description: "You cannot send to your own address." });
      return;
    }

    setSending(true);
    try {
      const amountObj = Amount.parse(String(parsed), tokenMeta);
      const tx = await withSponsoredFeeFallback(sponsoredFeesEnabled, (feeMode) =>
        wallet.transfer(tokenMeta, [{ to: to as Address, amount: amountObj }], { feeMode })
      );
      await tx.wait();
      const hash = tx.hash;
      const amountLabel = `${parsed.toLocaleString(undefined, { maximumFractionDigits: decimalsHint })} ${token}`;
      toast.success("Tokens sent", {
        description: `${amountLabel} on Sepolia.${
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
      onTransactionComplete?.({ hash, type: "Send", amountLabel });
      setAmount("");
      setRecipient("");
    } catch (error) {
      console.error(error);
      toast.error("Send failed", {
        description: error instanceof Error ? error.message : "Check the recipient and try again."
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <article className="card h-full fade-up fade-up-delay-2">
      <div className="card-inner h-full px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-300">
              <Send className="h-3 w-3" />
              Transfer
            </p>
            <h3 className="mt-3 text-lg font-semibold text-white">Send tokens</h3>
            <p className="mt-1 text-xs text-slate-300">
              Uses <span className="font-medium text-slate-200">wallet.transfer()</span> (StarkZap v2) on Sepolia —
              USDC, WBTC, or STRK.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <div>
            <p className="mb-1.5 text-xs text-slate-400">Token</p>
            <div className="grid grid-cols-3 gap-2">
              {TOKEN_OPTIONS.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setToken(sym)}
                  className={`rounded-xl border px-2 py-2 text-xs font-medium transition sm:text-sm ${
                    token === sym
                      ? "border-primary bg-primary/20 text-white"
                      : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-primary/50"
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Available:{" "}
              <span className="text-slate-400">
                {maxBalance.toLocaleString(undefined, { maximumFractionDigits: decimalsHint })} {token}
              </span>
            </p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-400">Amount</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-400">Recipient address</span>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 font-mono text-xs text-white placeholder:text-slate-600 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40 sm:text-sm"
            />
          </label>

          <button
            type="button"
            disabled={sending}
            onClick={() => void handleSend()}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
