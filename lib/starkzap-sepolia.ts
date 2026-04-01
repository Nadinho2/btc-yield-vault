import { sepoliaTokens } from "starkzap";

/** Sepolia WBTC + USDC for DCA and Vesu lending flows */
export const SEPOLIA_WBTC = sepoliaTokens.WBTC;
export const SEPOLIA_USDC = sepoliaTokens.USDC;

/** Fallback testnet supply APY when markets API is unavailable (percent, e.g. 2.4 = 2.4%) */
export const FALLBACK_SUPPLY_APY = {
  BTC: 2.4,
  USDC: 3.8
} as const;
