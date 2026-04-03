import { createDcaToCalls, BASE_URL, SEPOLIA_BASE_URL } from "@avnu/avnu-sdk";
import moment from "moment";
import { CallData } from "starknet";
import type { Call } from "starknet";
import type { Amount, Token } from "starkzap";

/** Match StarkZap `AvnuDcaProvider` — amounts as hex felts. */
export function avnuHexAmount(value: bigint): string {
  return `0x${value.toString(16)}`;
}

/** Same normalization as `starkzap` `normalizeAvnuCalls` before `wallet.execute`. */
function normalizeCallsForWallet(calls: Call[]): Call[] {
  return calls.map((call) => ({
    contractAddress: call.contractAddress,
    entrypoint: `${call.entrypoint}`,
    calldata: CallData.compile(call.calldata ?? [])
  }));
}

/**
 * Build DCA calls via AVNU using a real `moment.Duration` for `frequency`.
 * StarkZap’s provider passes an ISO string inside a `toJSON` shim; AVNU’s API/SDK expect
 * `moment.duration(...)`, which serializes correctly and avoids opaque 400s.
 */
export async function prepareAvnuDcaCreateCalls(params: {
  sellToken: Token;
  buyToken: Token;
  sellAmount: Amount;
  sellAmountPerCycle: Amount;
  frequency: "weekly" | "monthly";
  traderAddress: string;
}): Promise<Call[]> {
  const trader = params.traderAddress.trim();
  const order = {
    sellTokenAddress: String(params.sellToken.address),
    buyTokenAddress: String(params.buyToken.address),
    sellAmount: avnuHexAmount(params.sellAmount.toBase()),
    sellAmountPerCycle: avnuHexAmount(params.sellAmountPerCycle.toBase()),
    frequency:
      params.frequency === "weekly"
        ? moment.duration(1, "weeks")
        : moment.duration(1, "months"),
    pricingStrategy: {} as Record<string, never>,
    traderAddress: trader
  };

  const failures: string[] = [];
  for (const baseUrl of [SEPOLIA_BASE_URL, BASE_URL]) {
    try {
      const { calls } = await createDcaToCalls(order, { baseUrl });
      if (!calls?.length) throw new Error("AVNU returned no calls");
      return normalizeCallsForWallet(calls);
    } catch (e) {
      failures.push(`${baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`AVNU prepare DCA create failed (${failures.join(" | ")})`);
}
