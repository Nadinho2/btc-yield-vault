"use client";

import { useMemo } from "react";
import { Copy, ExternalLink, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { WalletInterface } from "starkzap";
import type { StarknetNetwork } from "@/hooks/useStarkzap";

type Props = {
  wallet: WalletInterface | null;
  walletReady: boolean;
  network: StarknetNetwork;
  explorerBaseUrl: string;
};

function normalizeAddress(w: WalletInterface | null): string | null {
  if (!w) return null;
  const a = w.address;
  if (typeof a === "string" && a.length > 0) return a;
  if (a != null) return String(a);
  return null;
}

export function StarknetAddressCard({ wallet, walletReady, network, explorerBaseUrl }: Props) {
  const fullAddress = useMemo(() => normalizeAddress(wallet), [wallet]);

  const short =
    fullAddress && fullAddress.length > 14
      ? `${fullAddress.slice(0, 6)}…${fullAddress.slice(-4)}`
      : fullAddress ?? "";

  const explorerUrl = fullAddress ? `${explorerBaseUrl}/contract/${encodeURIComponent(fullAddress)}` : null;

  const copyAddress = async () => {
    if (!fullAddress) return;
    try {
      await navigator.clipboard.writeText(fullAddress);
      toast.success("Address copied", {
        description: "Starknet address is on your clipboard."
      });
    } catch {
      toast.error("Could not copy", {
        description: "Your browser blocked clipboard access."
      });
    }
  };

  if (!walletReady || !fullAddress) {
    return (
      <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-br from-slate-950/90 via-slate-950/70 to-primary/5 p-5 shadow-lg shadow-black/40 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight text-white">
              Your Starknet wallet address
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Connect your wallet and complete setup to view your Starknet address, copy it, and open it
              on Voyager (Sepolia) or your network explorer.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-slate-950/95 via-slate-900/80 to-primary/10 p-5 shadow-lg shadow-primary/10 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 ring-1 ring-primary/40">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight text-white">
              Your Starknet wallet address
            </h2>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-primary/90">
              {network === "mainnet" ? "Mainnet" : "Sepolia testnet"}
            </p>
            <p className="mt-3 font-mono text-base font-semibold tracking-tight text-white">{short}</p>
            <p className="mt-2 break-all font-mono text-xs leading-relaxed text-slate-400">{fullAddress}</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[200px]">
          <button
            type="button"
            onClick={copyAddress}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Copy className="h-4 w-4 shrink-0" />
            Copy address
          </button>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-700/90 bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-primary/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              {network === "mainnet" ? "Starkscan (Mainnet)" : "Voyager (Sepolia)"}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
