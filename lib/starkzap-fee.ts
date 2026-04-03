/**
 * Run a wallet operation with sponsored fees when configured, falling back to user-paid
 * when the paymaster path cannot complete (RPC rejection, wrong method, or browser fetch/CORS/network).
 * Cartridge often surfaces unreachable paymaster as generic `Failed to fetch`, not "paymaster" in text.
 */
function collectErrorText(e: unknown, depth = 0): string {
  if (depth > 8) return "";
  if (e instanceof Error) {
    let s = e.message;
    if (e.cause != null) s += " " + collectErrorText(e.cause, depth + 1);
    return s;
  }
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

function shouldFallbackFromSponsoredToUserPays(e: unknown): boolean {
  const msg = collectErrorText(e);
  if (/paymaster|method not found/i.test(msg)) return true;
  if (
    /failed to fetch|networkerror|network error|load failed|fetch failed|aborted|abort$|econnreset|etimedout|socket|timed out/i.test(
      msg
    )
  ) {
    return true;
  }
  // AVNU prepare sometimes fails only on sponsored path (SDK/API); user_pays can succeed.
  if (/avnu|prepare DCA|prepare.*create|cannot read properties of undefined|reading '0'/i.test(msg)) {
    return true;
  }
  return false;
}

export async function withSponsoredFeeFallback<T>(
  sponsoredConfigured: boolean,
  run: (feeMode: "sponsored" | "user_pays") => Promise<T>
): Promise<T> {
  if (sponsoredConfigured) {
    try {
      return await run("sponsored");
    } catch (e) {
      if (shouldFallbackFromSponsoredToUserPays(e)) {
        return await run("user_pays");
      }
      throw e;
    }
  }
  return await run("user_pays");
}
