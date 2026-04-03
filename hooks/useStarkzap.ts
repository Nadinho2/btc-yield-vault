"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useUser } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { toast } from "sonner";
import { OnboardStrategy, StarkZap } from "starkzap";
import type { SDKConfig, WalletInterface } from "starkzap";
import { ensureStarknetRpcProxyWarm } from "@/lib/starknet-rpc-warm";

const CARTRIDGE_PAYMASTER_NODE_URL =
  process.env.NEXT_PUBLIC_CARTRIDGE_PAYMASTER_NODE_URL?.trim() ?? "";

export type StarknetNetwork = "sepolia" | "mainnet";

const sdkByNetwork: Partial<Record<StarknetNetwork, StarkZap>> = {};

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

    const sdk = new StarkZap(sdkConfig);
    sdkByNetwork[network] = sdk;
  }
  return sdkByNetwork[network] as StarkZap;
}

export function useStarkzap(network: StarknetNetwork): StarkZap {
  return useMemo(() => getStarkzap(network), [network]);
}

type LinkedWalletLike = {
  address?: string | null;
  type?: string;
  chainType?: string | null;
  chain_type?: string | null;
  id?: string | null;
  wallet_id?: string | null;
  walletId?: string | null;
  public_key?: string | null;
  publicKey?: string | null;
};

type PrivyUserLike = {
  linkedAccounts?: unknown[];
  wallet?: LinkedWalletLike;
};

function asNonEmptyString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function chainOf(w: LinkedWalletLike): string {
  return String(w.chainType ?? w.chain_type ?? "").toLowerCase();
}

function walletIdFrom(w: LinkedWalletLike): string | undefined {
  return asNonEmptyString(w.id) ?? asNonEmptyString(w.wallet_id) ?? asNonEmptyString(w.walletId);
}

function publicKeyFrom(w: LinkedWalletLike): string | undefined {
  return asNonEmptyString(w.public_key) ?? asNonEmptyString(w.publicKey);
}

function addressFrom(w: LinkedWalletLike): string | undefined {
  return asNonEmptyString(w.address);
}

/** True if Privy already shows a Starknet wallet on the user (do not provision a second one). */
function hasLinkedStarknetAccount(user: PrivyUserLike | null | undefined): boolean {
  const direct = user?.wallet;
  if (direct && typeof direct === "object" && chainOf(direct) === "starknet") return true;
  for (const acc of user?.linkedAccounts ?? []) {
    if (!acc || typeof acc !== "object") continue;
    if (chainOf(acc as LinkedWalletLike) === "starknet") return true;
  }
  return false;
}

function extractStarknetPrivyWallet(user: PrivyUserLike | null | undefined) {
  const directWallet = user?.wallet;
  if (directWallet && typeof directWallet === "object") {
    const chain = chainOf(directWallet);
    const walletId = walletIdFrom(directWallet);
    const publicKey = publicKeyFrom(directWallet);
    const address = addressFrom(directWallet);
    if (chain === "starknet" && walletId && publicKey && address) {
      return { walletId, publicKey, address };
    }
  }

  const accounts = user?.linkedAccounts ?? [];
  for (const acc of accounts) {
    if (!acc || typeof acc !== "object") continue;
    const w = acc as LinkedWalletLike;
    if (chainOf(w) !== "starknet") continue;
    const walletId = walletIdFrom(w);
    const publicKey = publicKeyFrom(w);
    const address = addressFrom(w);
    if (walletId && publicKey && address) {
      return { walletId, publicKey, address };
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Privy `useSignRawHash` → iframe `walletProxy`; first sign can run before the embedded-wallet iframe is ready. */
function isEmbeddedWalletSignerNotReadyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /wallet proxy not initialized|embedded wallet proxy not initialized|embedded_wallet_webview_not_loaded/i.test(
    msg
  );
}

type SignRawHashFn = (input: {
  address: `0x${string}`;
  chainType: "starknet";
  hash: `0x${string}`;
}) => Promise<{ signature: `0x${string}` }>;

/**
 * Retry Starknet raw hash signing until the Privy embedded-wallet iframe has initialized
 * (otherwise: "Wallet proxy not initialized"). Uses a wall-clock deadline so slow devices / ad blockers
 * get more time than a fixed attempt count.
 */
async function signStarknetHashWithProxyRetry(
  signRawHash: SignRawHashFn,
  starknetAddress: string,
  hash: `0x${string}`
): Promise<string> {
  const deadline = Date.now() + 120_000;
  let attempt = 0;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const { signature } = await signRawHash({
        address: starknetAddress as `0x${string}`,
        chainType: "starknet",
        hash
      });
      return signature;
    } catch (e) {
      lastErr = e;
      if (isEmbeddedWalletSignerNotReadyError(e)) {
        attempt += 1;
        await sleep(Math.min(100 + attempt * 50, 2500));
        continue;
      }
      throw e;
    }
  }
  const hint =
    "Privy embedded signer did not load in time. Allow third-party cookies / disable strict tracking blocking for this site, then refresh and try again.";
  throw new Error(
    `${lastErr instanceof Error ? lastErr.message : String(lastErr)} ${hint}`
  );
}

/**
 * Privy sometimes hydrates `linkedAccounts` a moment after `authenticated` flips. Retry refresh + short
 * delays so we reuse an existing Starknet wallet instead of calling createExtendedChainWallet too early.
 */
async function resolveStarknetCredentialsWithRetries(
  getUser: () => PrivyUserLike | undefined,
  refreshUser: () => Promise<unknown>
): Promise<{ creds: { walletId: string; publicKey: string; address: string } | null; snapshot: PrivyUserLike }> {
  let snapshot = getUser() as PrivyUserLike;
  for (let attempt = 0; attempt < 6; attempt++) {
    const found = extractStarknetPrivyWallet(snapshot);
    if (found) return { creds: found, snapshot };

    const refreshed = await refreshUser();
    if (refreshed) snapshot = refreshed as PrivyUserLike;
    const afterRefresh = extractStarknetPrivyWallet(snapshot);
    if (afterRefresh) return { creds: afterRefresh, snapshot };

    await sleep(200 + attempt * 150);
    snapshot = (getUser() as PrivyUserLike) ?? snapshot;
  }
  return { creds: null, snapshot };
}

function isFullStarkzapWallet(w: unknown): w is WalletInterface {
  if (!w || typeof w !== "object") return false;
  const o = w as WalletInterface;
  return typeof o.transfer === "function" && typeof o.swap === "function";
}

function isTransientNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /failed to fetch|networkerror|network error|load failed|fetch failed|aborted|abort$/i.test(msg);
}

/** Undeployed accounts have 0 ETH; user-paid deploy requires prefunded Sepolia STRK/ETH. */
function isInsufficientBalanceError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /exceed balance|balance \(0\)|insufficient.*balance|exceeds balance/i.test(msg);
}

/**
 * Deploy: `sponsored` uses Cartridge from the browser — wrong URL / CORS / ad-blockers → "Failed to fetch".
 * `user_pays` needs prefunded Sepolia STRK/ETH (undeployed accounts start at 0).
 * When paymaster is configured we try sponsored first; on **connectivity-only** failure we fall back to user_pays
 * (works if the user funded the address). Otherwise we surface a single message covering both paths.
 */
async function onboardPrivyStarkzapWallet(
  sdk: StarkZap,
  creds: { walletId: string; publicKey: string; address: string },
  signRawHashForStarknet: (hash: string) => Promise<string>,
  sponsoredEnabled: boolean
): Promise<WalletInterface> {
  const privyResolve = async () => ({
    walletId: creds.walletId,
    publicKey: creds.publicKey,
    rawSign: async (wid: string, hash: string) => {
      if (wid !== creds.walletId) {
        console.warn(
          `[useStarkzap] rawSign walletId mismatch (got ${wid}, expected ${creds.walletId})`
        );
      }
      return signRawHashForStarknet(hash);
    }
  });

  const runOnboard = (feeMode: "sponsored" | "user_pays") =>
    sdk.onboard({
      strategy: OnboardStrategy.Privy,
      privy: { resolve: privyResolve },
      deploy: "if_needed",
      feeMode
    });

  async function runWithRetries(feeMode: "sponsored" | "user_pays"): Promise<WalletInterface> {
    let lastErr: unknown;
    for (let retry = 0; retry < 3; retry++) {
      try {
        const result = await runOnboard(feeMode);
        return result.wallet;
      } catch (e) {
        lastErr = e;
        if (retry < 2 && isTransientNetworkError(e)) {
          await sleep(500 * (retry + 1));
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  if (sponsoredEnabled) {
    try {
      return await runWithRetries("sponsored");
    } catch (sponsoredErr) {
      const paymasterLikelyUnreachable = isTransientNetworkError(sponsoredErr);
      if (paymasterLikelyUnreachable) {
        console.warn(
          "[useStarkzap] Sponsored deploy failed (network/paymaster). Retrying with user-paid gas.",
          sponsoredErr
        );
        try {
          return await runWithRetries("user_pays");
        } catch (userPaysErr) {
          if (isInsufficientBalanceError(userPaysErr)) {
            throw new Error(
              `Deploy failed: gasless path could not reach the paymaster (${sponsoredErr instanceof Error ? sponsoredErr.message : String(sponsoredErr)}). User-paid deploy also failed (balance 0 on ${creds.address}). Fix NEXT_PUBLIC_CARTRIDGE_PAYMASTER_NODE_URL to a Sepolia Cartridge node reachable from the browser, or fund this address with Sepolia STRK/ETH and retry (e.g. https://starknet-faucet.vercel.app/).`
            );
          }
          throw userPaysErr;
        }
      }
      throw sponsoredErr;
    }
  }

  try {
    return await runWithRetries("user_pays");
  } catch (e) {
    if (isInsufficientBalanceError(e)) {
      throw new Error(
        `Cannot deploy Starknet account: balance is 0 (user-paid gas). Set NEXT_PUBLIC_CARTRIDGE_PAYMASTER_NODE_URL for sponsored deploy, or send Sepolia STRK/ETH to ${creds.address} and retry (e.g. https://starknet-faucet.vercel.app/). Original: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    throw e;
  }
}

export type UseStarkzapWalletResult = {
  sdk: StarkZap;
  wallet: WalletInterface | null;
  address: string | null;
  balancePreview: string | undefined;
  walletReady: boolean;
  walletOpsCapable: boolean;
  accountDeployed: boolean | null;
  sponsoredFeesEnabled: boolean;
  walletLoading: boolean;
  walletStatusText: string | null;
  walletError: string | null;
  network: StarknetNetwork;
  connectStarkWallet: () => Promise<void>;
};

/**
 * StarkZap v2: `sdk.onboard({ strategy: Privy })` + Privy `raw_sign`.
 * Reuses an existing Starknet linked account when possible; only calls `createExtendedChainWallet`
 * if the user truly has no Starknet wallet on their Privy account (after refresh retries).
 */
export function useStarkzapWallet(network: StarknetNetwork): UseStarkzapWalletResult {
  const sdk = useStarkzap(network);
  const { createWallet: createExtendedChainWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const { refreshUser } = useUser();
  const { ready: privyReady, authenticated, user } = usePrivy();
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
    if (!sdk) {
      toast.error("SDK not initialized");
      return;
    }

    if (!privyReady || !authenticated || !userRef.current) return;

    const existingWallet = walletRef.current;
    if (existingWallet && isFullStarkzapWallet(existingWallet)) return;

    if (connectingRef.current) return;

    if (!appId) {
      setWalletError("Missing NEXT_PUBLIC_PRIVY_APP_ID");
      toast.error("Missing Privy App ID");
      return;
    }

    connectingRef.current = true;
    setWalletLoading(true);
    setWalletError(null);

    if (existingWallet && !isFullStarkzapWallet(existingWallet)) {
      setWallet(null);
      setBalancePreview(undefined);
    }

    setWalletStatusText("Connecting your Starknet wallet…");

    try {
      const { creds: resolvedCreds, snapshot } = await resolveStarknetCredentialsWithRetries(
        () => userRef.current as PrivyUserLike,
        refreshUser
      );

      let creds = resolvedCreds;

      if (!creds && !hasLinkedStarknetAccount(snapshot)) {
        setWalletStatusText("Creating your Starknet wallet... (10-25 seconds)");
        const created = await createExtendedChainWallet({ chainType: "starknet" });
        const w = created.wallet as {
          id?: string;
          address?: string;
          chain_type?: string;
          public_key?: string;
          publicKey?: string;
        };
        if (w?.id && w.address) {
          const pk = asNonEmptyString(w.public_key) ?? asNonEmptyString(w.publicKey);
          if (pk) {
            creds = { walletId: w.id, publicKey: pk, address: w.address };
          }
        }
        if (!creds) {
          const fresh = await refreshUser();
          const afterCreate = created.user ?? fresh ?? snapshot;
          creds =
            extractStarknetPrivyWallet(afterCreate as PrivyUserLike) ??
            extractStarknetPrivyWallet(fresh as PrivyUserLike);
        }
      }

      if (!creds && hasLinkedStarknetAccount(snapshot)) {
        throw new Error(
          "This account already has a Starknet wallet, but signer details did not load yet. Reload the page or click Retry."
        );
      }

      if (!creds) {
        throw new Error(
          "No Starknet wallet found. If you just signed in, reload once; otherwise the wallet could not be created."
        );
      }

      if (network === "sepolia" && process.env.NEXT_PUBLIC_STARKNET_RPC_DIRECT !== "true") {
        setWalletStatusText("Preparing Starknet RPC…");
        await ensureStarknetRpcProxyWarm();
      }

      setWalletStatusText("Linking wallet to StarkZap…");
      const starknetWallet = await onboardPrivyStarkzapWallet(
        sdk,
        creds,
        async (hash: string) => {
          const normalized = (hash.startsWith("0x") ? hash : `0x${hash}`) as `0x${string}`;
          return signStarknetHashWithProxyRetry(signRawHash, creds.address, normalized);
        },
        sponsoredEnabled
      );

      if (!isFullStarkzapWallet(starknetWallet)) {
        throw new Error("Wallet is not ready for StarkZap transfers. Try reloading the page.");
      }

      setWallet(starknetWallet);
      setWalletStatusText(null);
      toast.success("✅ Starknet wallet connected!");

      let preview: string | undefined;
      try {
        const w = starknetWallet as unknown as { getBalance?: () => Promise<unknown> };
        if (typeof w.getBalance === "function") {
          const bal = await w.getBalance();
          preview = bal !== undefined ? `${bal?.toString?.() ?? bal}` : undefined;
        }
      } catch {
        preview = undefined;
      }
      setBalancePreview(preview);
    } catch (error) {
      console.error("[useStarkzap] wallet creation failed", error);
      const raw = error instanceof Error ? error.message : String(error);
      const fetchFailed =
        raw === "Failed to fetch" || /failed to fetch/i.test(raw) || /networkerror/i.test(raw);
      const message = fetchFailed
        ? `${raw} — Usually Starknet RPC (e.g. /api/starknet-rpc) or a slow dev compile. Not a new wallet: we only provision when no Starknet wallet exists. Set STARKNET_RPC_URL on Vercel, wait and Retry, or try next dev --turbopack.`
        : raw;
      setWalletStatusText("Failed to connect wallet. Please try again.");
      setWalletError(message);
      toast.error("Wallet connection failed", { description: fetchFailed ? "Network / RPC issue" : raw });
      setWallet(null);
      setBalancePreview(undefined);
    } finally {
      setWalletLoading(false);
      connectingRef.current = false;
    }
  }, [
    sdk,
    privyReady,
    authenticated,
    sponsoredEnabled,
    createExtendedChainWallet,
    refreshUser,
    signRawHash,
    appId,
    network
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
