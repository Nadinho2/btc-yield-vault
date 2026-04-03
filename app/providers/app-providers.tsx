"use client";

import { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { Toaster } from "sonner";
import { ReactQueryClientProvider } from "./react-query-client-provider";
import { WarmStarknetRpcProxy } from "@/components/WarmStarknetRpcProxy";
import { privyClientConfig } from "./privy-config";

type Props = {
  children: ReactNode;
  privyAppId?: string;
};

export function AppProviders({ children, privyAppId }: Props) {
  const isValidPrivyAppId =
    typeof privyAppId === "string" &&
    privyAppId.trim().length > 0 &&
    privyAppId !== "YOUR_PRIVY_APP_ID";

  if (!isValidPrivyAppId) {
    return (
      <ReactQueryClientProvider>
        <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4">
          <div className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-100">
            <h1 className="text-lg font-semibold">Privy App ID is missing</h1>
            <p className="mt-2 text-sm text-amber-100/90">
              Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in <code>.env.local</code> (local) or in your
              hosting provider&apos;s environment variables (e.g. Vercel), then redeploy or restart the
              dev server.
            </p>
            <p className="mt-3 text-xs text-amber-100/75">
              Example: <code>NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id</code>
            </p>
          </div>
        </div>
        <Toaster position="top-right" richColors />
      </ReactQueryClientProvider>
    );
  }

  return (
    <PrivyProvider appId={privyAppId} config={privyClientConfig}>
      <WarmStarknetRpcProxy />
      <ReactQueryClientProvider>
        {children}
        <Toaster position="top-right" richColors />
      </ReactQueryClientProvider>
    </PrivyProvider>
  );
}
