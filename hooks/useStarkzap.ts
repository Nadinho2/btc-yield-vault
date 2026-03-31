"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useUser } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { OnboardStrategy, StarkZap } from "starkzap";
import type { WalletInterface } from "starkzap";

const PRIVY_API_BASE = "https://api.privy.io/v1";

let singletonSdk: StarkZap | null = null;

function getStarkzap(): StarkZap {
  if (!singletonSdk) {
    singletonSdk = new StarkZap({
      network: "sepolia",
      gasless: true
    } as any);
  }
  return singletonSdk;
}

/**
 * Singleton StarkZap v2 client (sepolia, gasless).
 */
export function useStarkzap(): StarkZap {
  return useMemo(() => getStarkzap(), []);
}

type LinkedWalletLike = {
  type?: string;
  chainType?: string;
  chain_type?: string;
  id?: string;
  wallet_id?: string;
  public_key?: string;
  publicKey?: string;
};

/**
 * Find a Starknet embedded wallet (Privy Tier 2) on the user.
 * Same linked-account shape for Google and email login once authenticated.
 */
export function extractStarknetPrivyWallet(user: { linkedAccounts?: unknown[] } | null | undefined) {
  const accounts = user?.linkedAccounts ?? [];
  for (const acc of accounts) {
    if (!acc || typeof acc !== "object") continue;
    const w = acc as LinkedWalletLike;
    if (w.type !== "wallet") continue;
    const chain = String(w.chainType ?? w.chain_type ?? "").toLowerCase();
    if (chain !== "starknet") continue;
    const walletId = w.id ?? w.wallet_id;
    const publicKey = w.public_key ?? w.publicKey;
    if (typeof walletId === "string" && typeof publicKey === "string") {
      return { walletId, publicKey };
    }
  }
  return null;
}

/** Wallet payload returned by `extended-chains` createWallet (snake_case and/or camelCase). */
function credsFromPrivyApiWallet(w: {
  id: string;
  chain_type?: string;
  chainType?: string;
  public_key?: string;
  publicKey?: string;
}) {
  const chain = String(w.chain_type ?? w.chainType ?? "").toLowerCase();
  if (chain !== "starknet") return null;
  const pk = w.public_key ?? w.publicKey;
  if (typeof w.id === "string" && typeof pk === "string" && pk.length > 0) {
    return { walletId: w.id, publicKey: pk };
  }
  return null;
}

async function privyRawSignWithAccessToken(
  walletId: string,
  messageHash: string,
  getAccessToken: () => Promise<string | null>,
  appId: string
): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Missing Privy session token");
  }
  const res = await fetch(`${PRIVY_API_BASE}/wallets/${walletId}/raw_sign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "privy-app-id": appId
    },
    body: JSON.stringify({ params: { hash: messageHash } })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Privy raw_sign failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { signature?: string; data?: { signature?: string } };
  const sig = json.signature ?? json.data?.signature;
  if (typeof sig !== "string") {
    throw new Error("Privy raw_sign: missing signature in response");
  }
  return sig;
}

export type UseStarkzapWalletResult = {
  sdk: StarkZap;
  wallet: WalletInterface | null;
  address: string | null;
  balancePreview: string | undefined;
  walletReady: boolean;
  walletLoading: boolean;
  walletStatusText: string | null;
  walletError: string | null;
  /** Same as StarkZap `wallet.connect()` intent: Privy onboard + ensure ready. */
  connectStarkWallet: () => Promise<void>;
};

/**
 * After Privy login (Google or email), provisions/connects the Starknet wallet via StarkZap
 * `sdk.onboard({ strategy: "privy" })`. If no Starknet wallet exists yet, calls
 * `useCreateWallet` from `@privy-io/react-auth/extended-chains` with `chainType: "starknet"`.
 */
export function useStarkzapWallet(): UseStarkzapWalletResult {
  const sdk = useStarkzap();
  const { createWallet: createExtendedChainWallet } = useCreateWallet();
  const { refreshUser } = useUser();
  const {
    ready: privyReady,
    authenticated,
    user,
    getAccessToken
  } = usePrivy();

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

  const [wallet, setWallet] = useState<WalletInterface | null>(null);
  const [balancePreview, setBalancePreview] = useState<string | undefined>(undefined);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletStatusText, setWalletStatusText] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const connectingRef = useRef(false);
  /** Only one programmatic Starknet create per login session (Privy extended-chains). */
  const attemptedStarknetCreateRef = useRef(false);
  const walletRef = useRef<WalletInterface | null>(null);
  walletRef.current = wallet;
  const userRef = useRef(user);
  userRef.current = user;

  const address = wallet
    ? typeof wallet.address === "string"
      ? wallet.address
      : String(wallet.address)
    : null;

  const connectStarkWallet = useCallback(async () => {
    const currentUser = userRef.current;
    if (!privyReady || !authenticated || !currentUser) return;
    if (walletRef.current) return;
    if (connectingRef.current) return;
    if (!appId) {
      setWalletError("Missing NEXT_PUBLIC_PRIVY_APP_ID");
      return;
    }

    connectingRef.current = true;
    setWalletLoading(true);
    setWalletStatusText("Creating Starknet wallet...");
    setWalletError(null);

    try {
      let creds = extractStarknetPrivyWallet(currentUser);

      if (!creds && !attemptedStarknetCreateRef.current) {
        attemptedStarknetCreateRef.current = true;
        setWalletStatusText("Creating Starknet wallet...");
        try {
          const { user: userAfterCreate, wallet: apiWallet } =
            await createExtendedChainWallet({ chainType: "starknet" });
          creds =
            extractStarknetPrivyWallet(userAfterCreate) ?? credsFromPrivyApiWallet(apiWallet);
        } catch (e) {
          attemptedStarknetCreateRef.current = false;
          const msg = e instanceof Error ? e.message : String(e);
          if (/already|exist|duplicate/i.test(msg)) {
            const fresh = await refreshUser();
            creds = extractStarknetPrivyWallet(fresh);
          } else {
            throw e;
          }
        }
      }

      if (!creds) {
        const fresh = await refreshUser();
        creds = extractStarknetPrivyWallet(fresh);
      }

      if (!creds) {
        setWalletError("No Starknet embedded wallet found. Enable Starknet in the Privy dashboard.");
        setWalletStatusText(null);
        return;
      }

      setWalletStatusText("Connecting Starknet wallet...");
      const result = await sdk.onboard({
        strategy: OnboardStrategy.Privy,
        privy: {
          resolve: async () => ({
            walletId: creds!.walletId,
            publicKey: creds!.publicKey,
            rawSign: async (wid: string, hash: string) =>
              privyRawSignWithAccessToken(wid, hash, getAccessToken, appId)
          })
        },
        deploy: "if_needed",
        feeMode: "sponsored"
      } as any);

      setWallet(result.wallet);

      let preview: string | undefined;
      try {
        const w = result.wallet as any;
        if (typeof w.getBalance === "function") {
          const bal = await w.getBalance();
          preview = bal !== undefined ? `${bal?.toString?.() ?? bal}` : undefined;
        }
      } catch {
        preview = undefined;
      }
      setBalancePreview(preview);
      setWalletStatusText(null);
    } catch (e) {
      console.error(e);
      setWallet(null);
      setBalancePreview(undefined);
      setWalletStatusText(null);
      setWalletError(e instanceof Error ? e.message : "Failed to connect Starknet wallet");
    } finally {
      setWalletLoading(false);
      connectingRef.current = false;
    }
  }, [
    privyReady,
    authenticated,
    sdk,
    createExtendedChainWallet,
    refreshUser,
    getAccessToken,
    appId
  ]);

  const connectStarkWalletRef = useRef(connectStarkWallet);
  connectStarkWalletRef.current = connectStarkWallet;

  const linkedAccountsKey = useMemo(
    () => JSON.stringify(user?.linkedAccounts ?? []),
    [user?.linkedAccounts]
  );

  useEffect(() => {
    if (!privyReady) return;
    if (!authenticated) {
      setWallet(null);
      setBalancePreview(undefined);
      setWalletStatusText(null);
      setWalletError(null);
      setWalletLoading(false);
      attemptedStarknetCreateRef.current = false;
      return;
    }
    // Ref avoids effect loops when `connectStarkWallet` identity changes (Privy hooks).
    void connectStarkWalletRef.current();
  }, [privyReady, authenticated, user?.id, linkedAccountsKey]);

  const walletReady = !!wallet && !!address;

  return {
    sdk,
    wallet,
    address,
    balancePreview,
    walletReady,
    walletLoading,
    walletStatusText,
    walletError,
    connectStarkWallet
  };
}
