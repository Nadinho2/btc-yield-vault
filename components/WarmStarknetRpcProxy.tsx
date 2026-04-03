"use client";

import { useEffect } from "react";
import { ensureStarknetRpcProxyWarm } from "@/lib/starknet-rpc-warm";

/**
 * Start warming `/api/starknet-rpc` as early as possible so first StarkZap RPC traffic after load
 * is less likely to hit a cold Next.js compile of this route.
 */
export function WarmStarknetRpcProxy() {
  useEffect(() => {
    void ensureStarknetRpcProxyWarm();
  }, []);
  return null;
}
