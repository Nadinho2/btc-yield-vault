import type { StarkZap } from "starkzap";

/**
 * starknet.js RpcProvider uses `baseFetch` with no timeout. Some environments still abort long
 * requests; in `next dev`, the first `/api/starknet-rpc` compile can take 30–60s. Extend the budget
 * so JSON-RPC calls through the app proxy are less likely to surface as generic "Failed to fetch".
 */
export function patchStarknetProviderFetchBudget(
  sdk: StarkZap,
  budgetMs: number
): void {
  try {
    const provider = sdk.getProvider() as unknown as { baseFetch?: typeof fetch };
    if (typeof provider?.baseFetch !== "function") return;

    const inner = provider.baseFetch.bind(provider) as typeof fetch;
    provider.baseFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const budget = AbortSignal.timeout(budgetMs);
      const signal =
        init?.signal && !init.signal.aborted
          ? AbortSignal.any([init.signal, budget])
          : budget;
      return inner(input, { ...init, signal });
    };
  } catch {
    /* non-fatal */
  }
}
