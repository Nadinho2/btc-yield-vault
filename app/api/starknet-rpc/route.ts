import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Hobby ~10s; racing upstreams avoids sequential 28s timeouts killing the function (client sees "Failed to fetch"). */
export const maxDuration = 25;

const PROXY_UA = "btc-yield-vault-starknet-rpc-proxy/1.0";

/** JSON-RPC internal error (starknet.js expects `error` to be an object with code/message, not a string). */
const JSONRPC_INTERNAL = -32603;

/** Server-side upstreams. CORS does not apply here. Env URLs are tried first, then public fallbacks. */
function sepoliaUpstreamCandidates(): string[] {
  const fromEnv = [
    process.env.STARKNET_RPC_URL?.trim(),
    process.env.NEXT_PUBLIC_STARKNET_RPC_URL?.trim()
  ];
  const defaults = [
    "https://starknet-sepolia.drpc.org",
    "https://starknet-sepolia-rpc.publicnode.com",
    "https://free-rpc.nethermind.io/sepolia-juno",
    "https://starknet-sepolia.public.blastapi.io"
  ];
  const merged = [...fromEnv, ...defaults].filter(
    (u): u is string => typeof u === "string" && u.length > 0 && /^https?:\/\//i.test(u)
  );
  return [...new Set(merged)];
}

function readJsonRpcId(raw: string): string | number | null {
  try {
    const j = JSON.parse(raw) as { id?: unknown };
    if (j && typeof j === "object" && "id" in j && j.id !== undefined) {
      if (typeof j.id === "string" || typeof j.id === "number") return j.id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * starknet.js does `const { error, result } = await response.json()` without checking HTTP status.
 * `error` MUST be a JSON-RPC error object `{ code, message, data? }`, never a string, or RpcError shows "undefined: undefined: undefined".
 */
function jsonRpcProxyFailure(
  id: string | number | null,
  message: string,
  data?: unknown
): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: JSONRPC_INTERNAL,
        message,
        ...(data !== undefined ? { data } : {})
      }
    },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}

/** Forward upstream JSON-RPC as-is, including RPC-level `error` (e.g. CONTRACT_NOT_FOUND for undeployed accounts). */
function isJsonRpc2Body(text: string): boolean {
  try {
    const j = JSON.parse(text) as unknown;
    if (Array.isArray(j)) {
      return (
        j.length > 0 &&
        j.every(
          (item) =>
            item != null &&
            typeof item === "object" &&
            (item as { jsonrpc?: unknown }).jsonrpc === "2.0"
        )
      );
    }
    return (
      j != null &&
      typeof j === "object" &&
      (j as { jsonrpc?: unknown }).jsonrpc === "2.0"
    );
  } catch {
    return false;
  }
}

async function fetchUpstream(
  url: string,
  body: string,
  signal: AbortSignal
): Promise<NextResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": PROXY_UA
    },
    body,
    cache: "no-store",
    signal
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!isJsonRpc2Body(text)) {
    throw new Error(`upstream returned non-jsonrpc body: ${text.slice(0, 200)}`);
  }
  return new NextResponse(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

/**
 * Proxies Starknet Sepolia JSON-RPC from the browser (same origin) to a public node.
 * Fixes "Failed to fetch" when third-party RPCs block cross-origin browser requests.
 * Races several upstreams so Vercel's short function limit is not exceeded by slow dead nodes.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const rpcId = readJsonRpcId(body);
  const upstreams = sepoliaUpstreamCandidates();
  if (upstreams.length === 0) {
    return jsonRpcProxyFailure(
      rpcId,
      "Starknet RPC proxy: no upstream URL configured. Set STARKNET_RPC_URL on the server."
    );
  }

  const perTryMs = 7500;
  const controllers = upstreams.map(() => new AbortController());
  const timers = controllers.map((c) => setTimeout(() => c.abort(), perTryMs));

  const attempts = upstreams.map((url, i) =>
    fetchUpstream(url, body, controllers[i].signal)
      .then((res) => {
        controllers.forEach((c, j) => {
          if (j !== i) c.abort();
        });
        return res;
      })
      .finally(() => clearTimeout(timers[i]))
  );

  try {
    return await Promise.any(attempts);
  } catch (e) {
    const reasons =
      e instanceof AggregateError
        ? e.errors
            .map((err) => String((err as Error)?.message ?? err))
            .filter(Boolean)
            .slice(0, 3)
            .join(" | ")
        : String((e as Error)?.message ?? e);

    return jsonRpcProxyFailure(
      rpcId,
      "Starknet RPC proxy: all upstreams failed",
      { detail: reasons || "No Sepolia RPC responded in time" }
    );
  } finally {
    controllers.forEach((_, i) => clearTimeout(timers[i]));
  }
}
