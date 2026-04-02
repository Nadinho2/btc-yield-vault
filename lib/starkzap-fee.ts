/**
 * Run a wallet operation with sponsored fees when configured, falling back to user-paid
 * if the paymaster RPC rejects the request (matches onboard retry behavior).
 */
export async function withSponsoredFeeFallback<T>(
  sponsoredConfigured: boolean,
  run: (feeMode: "sponsored" | "user_pays") => Promise<T>
): Promise<T> {
  if (sponsoredConfigured) {
    try {
      return await run("sponsored");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/paymaster|Method not found/i.test(msg)) {
        return await run("user_pays");
      }
      throw e;
    }
  }
  return await run("user_pays");
}
