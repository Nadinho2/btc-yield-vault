/** Minimal JSON-RPC body so Next can compile /api/starknet-rpc before heavy StarkZap traffic. */
export const STARKNET_RPC_WARM_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 0,
  method: "starknet_chainId",
  params: []
});

const WARM_TIMEOUT_MS = 120_000;

let warmOnce: Promise<void> | null = null;

/**
 * Ensures at least one POST to `/api/starknet-rpc` has completed (or timed out) so `next dev`
 * webpack compilation of that route is less likely to overlap the first StarkZap RPC burst.
 */
export function ensureStarknetRpcProxyWarm(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (process.env.NEXT_PUBLIC_STARKNET_RPC_DIRECT === "true") {
    return Promise.resolve();
  }

  warmOnce ??= (async () => {
    try {
      await fetch(`${window.location.origin}/api/starknet-rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: STARKNET_RPC_WARM_BODY,
        cache: "no-store",
        signal: AbortSignal.timeout(WARM_TIMEOUT_MS)
      });
    } catch {
      /* wallet connect may still succeed; do not block forever */
    }
  })();

  return warmOnce;
}
