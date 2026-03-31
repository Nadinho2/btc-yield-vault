export async function loadHyperlane(feature = "Hyperlane bridge") {
  throw new Error(
    `[btc-yield-vault] ${feature} is disabled in this frontend build to keep Starknet core flows lightweight.`
  );
}
