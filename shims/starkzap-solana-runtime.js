export async function loadSolanaWeb3(feature = "Solana bridge") {
  throw new Error(
    `[btc-yield-vault] ${feature} is disabled in this frontend build to keep bundle size stable.`
  );
}
