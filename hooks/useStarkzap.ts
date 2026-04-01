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

type StarkZapEmbeddedWalletApi = {
  wallet?: {
    createEmbeddedWallet?: (args: { chain: "starknet"; paymaster: null }) => Promise<unknown>;
    setPaymaster?: (args: { nodeUrl: string }) => void;
  };
};

type LinkedWalletLike = {
  address?: string;
  type?: string;
  chainType?: string;
  chain_type?: string;
  id?: string;
  wallet_id?: string;
  public_key?: string;
  publicKey?: string;
};

type PrivyUserLike = {
  linkedAccounts?: unknown[];
  wallet?: LinkedWalletLike;
};

function extractStarknetPrivyWallet(user: PrivyUserLike | null | undefined) {
  const directWallet = user?.wallet;
  if (directWallet && typeof directWallet === "object") {
    const chain = String(directWallet.chainType ?? directWallet.chain_type ?? "").toLowerCase();
    const walletId = directWallet.id ?? directWallet.wallet_id;
    const publicKey = directWallet.public_key ?? directWallet.publicKey;
    if (chain === "starknet" && typeof walletId === "string" && typeof publicKey === "string") {
      return { walletId, publicKey };
    }
  }

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

function extractStarknetAddress(user: PrivyUserLike | null | undefined): string | null {
  const directAddress = user?.wallet?.address;
  const directChain = String(user?.wallet?.chainType ?? user?.wallet?.chain_type ?? "").toLowerCase();
  if (directChain === "starknet" && typeof directAddress === "string" && directAddress.length > 0) {
    return directAddress;
  }
  const accounts = user?.linkedAccounts ?? [];
  for (const acc of accounts) {
    if (!acc || typeof acc !== "object") continue;
    const w = acc as LinkedWalletLike;
    if (w.type !== "wallet") continue;
    const chain = String(w.chainType ?? w.chain_type ?? "").toLowerCase();
    if (chain !== "starknet") continue;
    if (typeof w.address === "string" && w.address.length > 0) return w.address;
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
  if (!token) throw new Error("Missing Privy session token");
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
  if (typeof sig !== "string") throw new Error("Privy raw_sign: missing signature in response");
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
  const { ready: privyReady, authenticated, user, getAccessToken } = usePrivy();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  const sponsoredEnabled = CARTRIDGE_PAYMASTER_NODE_URL.length > 0;

  const [wallet, setWallet] = useState<WalletInterface | null>(null);
  const [balancePreview, setBalancePreview] = useState<string | undefined>(undefined);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletStatusText, setWalletStatusText] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const connectingRef = useRef(false);
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
    setWalletStatusText("Creating your Starknet wallet... (10-25 seconds)");
    setWalletError(null);

    try {
      console.log("[useStarkzap] authenticated user", currentUser);
      const sdkWalletApi = sdk as unknown as StarkZapEmbeddedWalletApi;
      const createEmbeddedWallet = sdkWalletApi.wallet?.createEmbeddedWallet;
      if (typeof createEmbeddedWallet === "function") {
        // First login: create wallet without paymaster to avoid provisioning failures.
        const created = await createEmbeddedWallet({
          chain: "starknet",
          paymaster: null
        });
        console.log("[useStarkzap] createEmbeddedWallet result", created);

        // Future transactions: re-enable Cartridge paymaster.
        if (sponsoredEnabled && sdkWalletApi.wallet?.setPaymaster) {
          sdkWalletApi.wallet.setPaymaster({
            nodeUrl: CARTRIDGE_PAYMASTER_NODE_URL
          });
        }

        const createdWallet = created as WalletInterface | null;
        const createdAddress =
          createdWallet && createdWallet.address != null ? String(createdWallet.address) : "";
        if (!createdWallet || !createdAddress) {
          throw new Error("Embedded wallet created but not ready yet. Please retry.");
        }

        setWallet(createdWallet);
        let preview: string | undefined;
        try {
          const w = createdWallet as unknown as { getBalance?: () => Promise<unknown> };
          if (typeof w.getBalance === "function") {
            const bal = await w.getBalance();
            preview = bal !== undefined ? `${bal?.toString?.() ?? bal}` : undefined;
          }
        } catch {
          preview = undefined;
        }
        setBalancePreview(preview);
        setWalletStatusText(null);
        return;
      }

      console.warn("[useStarkzap] createEmbeddedWallet unavailable; using Privy onboard fallback");
      const existingAddress = extractStarknetAddress(currentUser as PrivyUserLike);
      if (existingAddress) {
        // Compatibility path: if user already has Starknet embedded wallet, use its address directly.
        setWallet({ address: existingAddress } as unknown as WalletInterface);
        setBalancePreview(undefined);
        setWalletStatusText(null);
        return;
      }
      setWalletStatusText("Connecting Starknet wallet...");
      const created = await createExtendedChainWallet({ chainType: "starknet" });
      const fresh = await refreshUser();
      const creds =
        extractStarknetPrivyWallet(created.user ?? fresh ?? currentUser) ??
        extractStarknetPrivyWallet(fresh);
      if (!creds) {
        throw new Error("No Starknet embedded wallet found after creation.");
      }

      let result: { wallet: WalletInterface };
      try {
        result = await sdk.onboard({
          strategy: OnboardStrategy.Privy,
          privy: {
            resolve: async () => ({
              walletId: creds.walletId,
              publicKey: creds.publicKey,
              rawSign: async (wid: string, hash: string) =>
                privyRawSignWithAccessToken(wid, hash, getAccessToken, appId)
            })
          },
          deploy: "if_needed",
          feeMode: sponsoredEnabled ? "sponsored" : "user_pays"
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const paymasterMethodUnsupported =
          sponsoredEnabled && /paymaster_buildTransaction|Method not found/i.test(msg);
        if (!paymasterMethodUnsupported) throw error;
        result = await sdk.onboard({
          strategy: OnboardStrategy.Privy,
          privy: {
            resolve: async () => ({
              walletId: creds.walletId,
              publicKey: creds.publicKey,
              rawSign: async (wid: string, hash: string) =>
                privyRawSignWithAccessToken(wid, hash, getAccessToken, appId)
            })
          },
          deploy: "if_needed",
          feeMode: "user_pays"
        });
      }

      const createdWallet = result.wallet;
      setWallet(createdWallet);
      let preview: string | undefined;
      try {
        const w = createdWallet as unknown as { getBalance?: () => Promise<unknown> };
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
      console.error("[useStarkzap] wallet creation failed", e, {
        user: currentUser,
        message: e instanceof Error ? e.message : String(e)
      });
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
