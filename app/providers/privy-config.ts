import type { PrivyClientConfig } from "@privy-io/react-auth";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

/**
 * Google + email login; Starknet embedded wallet is created via StarkZap (not Privy auto-create).
 */
export const privyClientConfig = {
  ...(wcProjectId ? { walletConnectCloudProjectId: wcProjectId } : {}),
  loginMethods: ["google", "email"],
  appearance: {
    theme: "dark" as const,
    accentColor: "#8B86FF" as const,
    landingHeader: "BTC Yield Vault",
    loginMessage: "Sign in with Google or email to create your Starknet wallet."
  },
  embeddedWallets: {
    /** Required for `useSignRawHash` / user-signer: iframe must load even when ETH/SOL auto-create is off. */
    showWalletUIs: true,
    ethereum: { createOnLogin: "off" as const },
    solana: { createOnLogin: "off" as const },
    starknet: { createOnLogin: "off" as const }
  }
} as unknown as PrivyClientConfig;
