import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Server-side upstreams (tried in order). CORS does not apply here. */
function sepoliaUpstreamCandidates(): string[] {
  const fromEnv = [
    process.env.STARKNET_RPC_URL?.trim(),
    process.env.NEXT_PUBLIC_STARKNET_RPC_URL?.trim()
  ];
  const defaults = [
    "https://starknet-sepolia-rpc.publicnode.com",
    "https://starknet-sepolia.public.blastapi.io",
    "https://free-rpc.nethermind.io/sepolia-juno"
  ];
  const merged = [...fromEnv, ...defaults].filter(
    (u): u is string => typeof u === "string" && u.length > 0 && /^https?:\/\//i.test(u)
  );
  return [...new Set(merged)];
}

/**
 * Proxies Starknet Sepolia JSON-RPC from the browser (same origin) to a public node.
 * Fixes "Failed to fetch" when third-party RPCs block cross-origin browser requests.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const upstreams = sepoliaUpstreamCandidates();
  let lastStatus = 502;
  let lastBody = "All Starknet Sepolia RPC upstreams failed";

  for (const url of upstreams) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(28_000)
      });
      const text = await res.text();
      if (res.ok) {
        return new NextResponse(text, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        });
      }
      lastStatus = res.status;
      lastBody = text.slice(0, 500);
    } catch {
      // try next upstream
    }
  }

  return NextResponse.json(
    { error: "starknet_rpc_proxy_upstream_failed", detail: lastBody },
    { status: lastStatus >= 400 ? lastStatus : 502 }
  );
}
