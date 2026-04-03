"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useUser } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { OnboardStrategy, StarkZap } from "starkzap";
import type { SDKConfig, WalletInterface } from "starkzap";

const PRIVY_API_BASE = "https://api.privy.io/v1";
const CARTRIDGE_PAYMASTER_NODE_URL =
  process.env.NEXT_PUBLIC_CARTRIDGE_PAYMASTER_NODE_URL?.trim() ?? "";

export type StarknetNetwork = "sepolia" | "mainnet";

const sdkByNetwork: Partial<Record<StarknetNetwork, StarkZap>> = {};

/**
 * Direct RPC fallback when not using the app proxy (SSR or NEXT_PUBLIC_STARKNET_RPC_DIRECT=true).
 */
const SEPOLIA_RPC_DEFAULT = "https://starknet-sepolia-rpc.publicnode.com";

function sepoliaRpcUrlForRuntime(): string {
  const envRpc = process.env.NEXT_PUBLIC_STARKNET_RPC_URL?.trim();
  const forceDirect = process.env.NEXT_PUBLIC_STARKNET_RPC_DIRECT === "true";
  if (typeof window !== "undefined" && !forceDirect) {
    return `${window.location.origin}/api/starknet-rpc`;
  }
  return envRpc && envRpc.length > 0 ? envRpc : SEPOLIA_RPC_DEFAULT;
}

export function getExplorerBaseUrl(network: StarknetNetwork): string {
  return network === "mainnet" ? "https://starkscan.co" : "https://sepolia.voyager.online";
}

function getStarkzap(network: StarknetNetwork): StarkZap {
  if (!sdkByNetwork[network]) {
    const sponsoredEnabled = CARTRIDGE_PAYMASTER_NODE_URL.length > 0;
    const envRpc = process.env.NEXT_PUBLIC_STARKNET_RPC_URL?.trim();
    const sdkConfig: SDKConfig & { gasless?: boolean } = {
      network,
      ...(network === "sepolia"
        ? { rpcUrl: sepoliaRpcUrlForRuntime() }
        : envRpc && envRpc.length > 0
          ? { rpcUrl: envRpc }
          : {}),
      gasless: sponsoredEnabled
    };
    if (sponsoredEnabled) {
      sdkConfig.paymaster = {
        nodeUrl: CARTRIDGE_PAYMASTER_NODE_URL
      };
    }

    sdkByNetwork[network] = new StarkZap(sdkConfig);
  }
  return sdkByNetwork[network] as StarkZap;
}

/**
 * Singleton StarkZap v2 client (sepolia, gasless).
 */
export function useStarkzap(network: StarknetNetwork): StarkZap {
  return useMemo(() => getStarkzap(network), [network]);
}

type StarkZapEmbeddedWalletApi = {
  wallet?: {
    createEmbeddedWallet?: (args: { chain: "starknet"; paymaster: null }) => Promise<unknown>;
    setPaymaster?: (args: { nodeUrl: string }) => void;
  };
};

type LinkedWalletLike = {
  address?: string | null;
  type?: string;
  chainType?: string | null;
  chain_type?: string | null;
  id?: string | null;
  wallet_id?: string | null;
  public_key?: string | null;
  publicKey?: string | null;
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

function isFullStarkzapWallet(w: unknown): w is WalletInterface {
  if (!w || typeof w !== "object") return false;
  const o = w as WalletInterface;
  return typeof o.transfer === "function" && typeof o.swap === "function";
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

async function onboardPrivyStarkzapWallet(
  sdk: StarkZap,
  creds: { walletId: string; publicKey: string },
  getAccessToken: () => Promise<string | null>,
  appId: string,
  sponsoredEnabled: boolean
): Promise<WalletInterface> {
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
  return result.wallet;
}

export type UseStarkzapWalletResult = {
  sdk: StarkZap;
  wallet: WalletInterface | null;
  address: string | null;
  balancePreview: string | undefined;
  walletReady: boolean;
  /** True when the connected object exposes StarkZap wallet transfer/swap (full SDK wallet). */
  walletOpsCapable: boolean;
  /** Null while checking; false if not deployed or stub wallet; true when safe to transact. */
  accountDeployed: boolean | null;
  sponsoredFeesEnabled: boolean;
  walletLoading: boolean;
  walletStatusText: string | null;
  walletError: string | null;
  network: StarknetNetwork;
  /** Same as StarkZap `wallet.connect()` intent: Privy onboard + ensure ready. */
  connectStarkWallet: () => Promise<void>;
};

/**
 * After Privy login (Google or email), provisions/connects the Starknet wallet via StarkZap
 * `sdk.onboard({ strategy: "privy" })`. If no Starknet wallet exists yet, calls
 * `useCreateWallet` from `@privy-io/react-auth/extended-chains` with `chainType: "starknet"`.
 */
export function useStarkzapWallet(network: StarknetNetwork): UseStarkzapWalletResult {
  const sdk = useStarkzap(network);
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
  const [accountDeployed, setAccountDeployed] = useState<boolean | null>(null);

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

  const walletOpsCapable = useMemo(() => {
    if (!wallet) return false;
    const w = wallet as WalletInterface;
    return typeof w.transfer === "function" && typeof w.swap === "function";
  }, [wallet]);

  useEffect(() => {
    if (!wallet) {
      setAccountDeployed(null);
      return;
    }
    const w = wallet as WalletInterface & { isDeployed?: () => Promise<boolean> };
    if (!walletOpsCapable || typeof w.isDeployed !== "function") {
      setAccountDeployed(false);
      return;
    }
    let cancelled = false;
    setAccountDeployed(null);
    void w
      .isDeployed()
      .then((deployed) => {
        if (!cancelled) setAccountDeployed(deployed);
      })
      .catch(() => {
        if (!cancelled) setAccountDeployed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, walletOpsCapable]);

  const connectStarkWallet = useCallback(async () => {
    const currentUser = userRef.current;
    if (!privyReady || !authenticated || !currentUser) return;

    const existingWallet = walletRef.current;
    if (existingWallet && isFullStarkzapWallet(existingWallet)) return;

    if (connectingRef.current) return;

    if (!appId) {
      setWalletError("Missing NEXT_PUBLIC_PRIVY_APP_ID");
      return;
    }

    // Lock before any setState so Strict Mode / effect re-runs cannot start a second connect.
    connectingRef.current = true;
    setWalletLoading(true);
    setWalletStatusText("Setting up your Starknet wallet...");
    setWalletError(null);

    try {
      if (existingWallet && !isFullStarkzapWallet(existingWallet)) {
        setWallet(null);
        setBalancePreview(undefined);
      }

      const sdkWalletApi = sdk as unknown as StarkZapEmbeddedWalletApi;
      const createEmbeddedWallet = sdkWalletApi.wallet?.createEmbeddedWallet;

      setWalletStatusText("Connecting Starknet wallet…");

      let userSnapshot = currentUser as PrivyUserLike;
      let creds = extractStarknetPrivyWallet(userSnapshot);
      if (!creds) {
        const refreshed = await refreshUser();
        if (refreshed) userSnapshot = refreshed as PrivyUserLike;
        creds = extractStarknetPrivyWallet(userSnapshot);
      }

      // StarkZap may expose Privy provisioning; the returned handle is not a full Wallet — only use
      // this when we still have no Starknet signer credentials.
      if (
        !creds &&
        typeof createEmbeddedWallet === "function"
      ) {
        await createEmbeddedWallet({
          chain: "starknet",
          paymaster: null
        });
        if (sponsoredEnabled && sdkWalletApi.wallet?.setPaymaster) {
          sdkWalletApi.wallet.setPaymaster({
            nodeUrl: CARTRIDGE_PAYMASTER_NODE_URL
          });
        }
        const afterProvision = await refreshUser();
        if (afterProvision) userSnapshot = afterProvision as PrivyUserLike;
        creds = extractStarknetPrivyWallet(userSnapshot);
      }

      if (!creds) {
        const created = await createExtendedChainWallet({ chainType: "starknet" });
        const fresh = await refreshUser();
        creds =
          extractStarknetPrivyWallet(created.user ?? fresh ?? userSnapshot) ??
          extractStarknetPrivyWallet(fresh);
      }

      if (!creds) {
        throw new Error(
          "No Starknet embedded wallet credentials found. If you just signed in, reload the page once."
        );
      }

      const createdWallet = await onboardPrivyStarkzapWallet(
        sdk,
        creds,
        getAccessToken,
        appId,
        sponsoredEnabled
      );

      if (!isFullStarkzapWallet(createdWallet)) {
        throw new Error("Connected wallet does not support StarkZap transfers. Please reload and try again.");
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
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const fetchFailed =
        raw === "Failed to fetch" || /failed to fetch/i.test(raw) || /networkerror/i.test(raw);
      const message = fetchFailed
        ? "Could not reach Starknet RPC. The app uses a same-origin proxy (/api/starknet-rpc). On Vercel, set STARKNET_RPC_URL or NEXT_PUBLIC_STARKNET_RPC_URL to a working Sepolia JSON-RPC URL, redeploy, and reload. For local debugging only, try NEXT_PUBLIC_STARKNET_RPC_DIRECT=true with NEXT_PUBLIC_STARKNET_RPC_URL."
        : raw;
      console.error("[useStarkzap] wallet creation failed", e, {
        user: currentUser,
        message: raw
      });
      setWallet(null);
      setBalancePreview(undefined);
      setWalletStatusText(null);
      setWalletError(message);
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
      connectingRef.current = false;
      setWallet(null);
      setBalancePreview(undefined);
      setWalletStatusText(null);
      setWalletError(null);
      setWalletLoading(false);
      return;
    }
    void connectStarkWalletRef.current();
  }, [privyReady, authenticated, user?.id, linkedAccountsKey, network]);

  /** Replace a non-StarkZap handle (e.g. legacy embedded object) with a full wallet via onboard. */
  useEffect(() => {
    if (!privyReady || !authenticated) return;
    if (wallet && !walletOpsCapable) {
      void connectStarkWalletRef.current();
    }
  }, [privyReady, authenticated, wallet, walletOpsCapable]);

  useEffect(() => {
    connectingRef.current = false;
    setWallet(null);
    setBalancePreview(undefined);
    setWalletError(null);
    setAccountDeployed(null);
    setWalletStatusText("Switching network...");
  }, [network]);

  const walletReady = !!wallet && !!address;

  return {
    sdk,
    wallet,
    address,
    balancePreview,
    walletReady,
    walletOpsCapable,
    accountDeployed,
    sponsoredFeesEnabled: sponsoredEnabled,
    walletLoading,
    walletStatusText,
    walletError,
    network,
    connectStarkWallet
  };
}
