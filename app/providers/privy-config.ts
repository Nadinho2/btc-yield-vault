import type { PrivyClientConfig } from "@privy-io/react-auth";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

/**
 * Privy client config including Starknet external wallets (Braavos, Argent/Ready) and WalletConnect.
 * Extended fields are cast until @privy-io/react-auth typings include all Starknet options.
 */
export const privyClientConfig = {
  ...(wcProjectId ? { walletConnectCloudProjectId: wcProjectId } : {}),
  loginMethods: ["email", "google", "wallet"],
  loginMethodsAndOrder: {
    primary: ["wallet_connect", "google", "email"],
    overflow: [] as []
  },
  appearance: {
    theme: "dark" as const,
    accentColor: "#8B86FF" as const,
    showWalletLoginFirst: true,
    landingHeader: "BTC Yield Vault",
    loginMessage: "Connect with Braavos or Ready Wallet (Argent), WalletConnect, Google, or email.",
    walletList: ["braavos", "argent", "wallet_connect"]
  },
  externalWallets: {
    braavos: { enabled: true },
    argent: { enabled: true },
    walletConnect: { enabled: true }
  },
  embeddedWallets: {
    ethereum: { createOnLogin: "off" as const },
    solana: { createOnLogin: "off" as const },
    starknet: { createOnLogin: "off" as const }
  }
} as unknown as PrivyClientConfig;
