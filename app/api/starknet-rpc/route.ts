import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Hobby ~10s; racing upstreams avoids sequential 28s timeouts killing the function (client sees "Failed to fetch"). */
export const maxDuration = 25;

const PROXY_UA = "btc-yield-vault-starknet-rpc-proxy/1.0";

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

/** True if this looks like a JSON-RPC 2.0 error payload (HTTP 200 but RPC failed). */
function jsonRpcResponseLooksOk(text: string): boolean {
  try {
    const j = JSON.parse(text) as unknown;
    if (Array.isArray(j)) {
      return j.every(
        (item) =>
          !item ||
          typeof item !== "object" ||
          !("error" in item) ||
          (item as { error?: unknown }).error == null
      );
    }
    if (j && typeof j === "object" && "error" in j) {
      return (j as { error?: unknown }).error == null;
    }
    return true;
  } catch {
    return true;
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
  if (!jsonRpcResponseLooksOk(text)) {
    throw new Error(`upstream json-rpc error: ${text.slice(0, 200)}`);
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
  const upstreams = sepoliaUpstreamCandidates();
  if (upstreams.length === 0) {
    return NextResponse.json(
      { error: "starknet_rpc_proxy_no_upstream", detail: "No RPC URLs configured" },
      { status: 500 }
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

    return NextResponse.json(
      {
        error: "starknet_rpc_proxy_upstream_failed",
        detail: reasons || "All Starknet Sepolia RPC upstreams failed"
      },
      { status: 502 }
    );
  } finally {
    controllers.forEach((_, i) => clearTimeout(timers[i]));
  }
}
