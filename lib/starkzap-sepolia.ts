import { sepoliaTokens, type Token } from "starkzap";

/** Sepolia WBTC + USDC for DCA and Vesu lending flows */
export const SEPOLIA_WBTC = sepoliaTokens.WBTC;
export const SEPOLIA_USDC = sepoliaTokens.USDC;
export const SEPOLIA_STRK = sepoliaTokens.STRK;

/** Dashboard token keys (BTC = WBTC on Sepolia) */
export type DashboardTokenSymbol = "USDC" | "BTC" | "STRK";

export const SEPOLIA_DASHBOARD_TOKENS: Record<DashboardTokenSymbol, Token> = {
  USDC: SEPOLIA_USDC,
  BTC: SEPOLIA_WBTC,
  STRK: SEPOLIA_STRK
};

/** Fallback testnet supply APY when markets API is unavailable (percent, e.g. 2.4 = 2.4%) */
export const FALLBACK_SUPPLY_APY = {
  BTC: 2.4,
  USDC: 3.8
} as const;
