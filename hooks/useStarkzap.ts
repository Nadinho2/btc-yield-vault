"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useUser } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { OnboardStrategy, StarkZap } from "starkzap";
import type { SDKConfig, WalletInterface } from "starkzap";

const PRIVY_API_BASE = "https://api.privy.io/v1";
const CARTRIDGE_PAYMASTER_NODE_URL =
  process.env.NEXT_PUBLIC_CARTRIDGE_PAYMASTER_NODE_URL?.trim() ?? "";

let singletonSdk: StarkZap | null = null;

function getStarkzap(): StarkZap {
  if (!singletonSdk) {
    const sponsoredEnabled = CARTRIDGE_PAYMASTER_NODE_URL.length > 0;
    const sdkConfig: SDKConfig & { gasless?: boolean } = {
      network: "sepolia",
      gasless: sponsoredEnabled
    };
    if (sponsoredEnabled) {
      sdkConfig.paymaster = {
        nodeUrl: CARTRIDGE_PAYMASTER_NODE_URL
      };
    }

    singletonSdk = new StarkZap(sdkConfig);
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

type StarkZapEmbeddedWalletApi = {
  wallet?: {
    createEmbeddedWallet?: (args: { chain: "starknet" }) => Promise<unknown>;
  };
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
} | null | undefined) {
  if (!w) return null;
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
  const sponsoredEnabled = CARTRIDGE_PAYMASTER_NODE_URL.length > 0;

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
    setWalletStatusText("Creating your Starknet wallet... (this may take 10-20 seconds)");
    setWalletError(null);

    try {
      console.log("[useStarkzap] authenticated user", currentUser);
      let creds = extractStarknetPrivyWallet(currentUser);

      if (!creds && !attemptedStarknetCreateRef.current) {
        attemptedStarknetCreateRef.current = true;
        setWalletStatusText("Creating your Starknet wallet... (this may take 10-20 seconds)");
        try {
          const maybeEmbeddedWalletCreator = (
            sdk as unknown as StarkZapEmbeddedWalletApi
          ).wallet?.createEmbeddedWallet;
          let apiWallet: {
            id: string;
            chain_type?: string;
            chainType?: string;
            public_key?: string;
            publicKey?: string;
          } | null = null;
          let userAfterCreate = currentUser;
          if (typeof maybeEmbeddedWalletCreator === "function") {
            const embeddedResult = await maybeEmbeddedWalletCreator({ chain: "starknet" });
            console.log("[useStarkzap] sdk.wallet.createEmbeddedWallet result", embeddedResult);
            const fresh = await refreshUser();
            userAfterCreate = fresh ?? currentUser;
          } else {
            const created = await createExtendedChainWallet({ chainType: "starknet" });
            userAfterCreate = created.user ?? currentUser;
            apiWallet = created.wallet ?? null;
            console.log("[useStarkzap] createExtendedChainWallet result", created);
          }
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
      const baseOnboardPayload = {
        strategy: OnboardStrategy.Privy,
        privy: {
          resolve: async () => ({
            walletId: creds!.walletId,
            publicKey: creds!.publicKey,
            rawSign: async (wid: string, hash: string) =>
              privyRawSignWithAccessToken(wid, hash, getAccessToken, appId)
          })
        },
        deploy: "if_needed" as const
      };

      let result: { wallet: WalletInterface };
      try {
        result = await sdk.onboard({
          ...baseOnboardPayload,
          feeMode: sponsoredEnabled ? "sponsored" : "user_pays"
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const paymasterMethodUnsupported =
          sponsoredEnabled && /paymaster_buildTransaction|Method not found/i.test(msg);
        if (!paymasterMethodUnsupported) throw error;
        // If endpoint is not a paymaster RPC, fallback to user-pays so wallet onboarding still works.
        result = await sdk.onboard({
          ...baseOnboardPayload,
          feeMode: "user_pays"
        });
      }

      setWallet(result.wallet);

      let preview: string | undefined;
      try {
        const w = result.wallet as unknown as { getBalance?: () => Promise<unknown> };
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
    sponsoredEnabled,
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
