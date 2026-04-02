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

export function getExplorerBaseUrl(network: StarknetNetwork): string {
  return network === "mainnet" ? "https://starkscan.co" : "https://sepolia.voyager.online";
}

function getStarkzap(network: StarknetNetwork): StarkZap {
  if (!sdkByNetwork[network]) {
    const sponsoredEnabled = CARTRIDGE_PAYMASTER_NODE_URL.length > 0;
    const sdkConfig: SDKConfig & { gasless?: boolean } = {
      network,
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
    if (walletRef.current) return;
    if (connectingRef.current) return;
    if (!appId) {
      setWalletError("Missing NEXT_PUBLIC_PRIVY_APP_ID");
      return;
    }

    connectingRef.current = true;
    setWalletLoading(true);
    setWalletStatusText("Setting up your Starknet wallet...");
    setWalletError(null);

    try {
      const sdkWalletApi = sdk as unknown as StarkZapEmbeddedWalletApi;
      const createEmbeddedWallet = sdkWalletApi.wallet?.createEmbeddedWallet;
      if (typeof createEmbeddedWallet === "function") {
        // First login: create wallet without paymaster to avoid provisioning failures.
        const created = await createEmbeddedWallet({
          chain: "starknet",
          paymaster: null
        });

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
  }, [privyReady, authenticated, user?.id, linkedAccountsKey, network]);

  useEffect(() => {
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
