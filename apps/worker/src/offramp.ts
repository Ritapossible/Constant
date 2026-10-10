/**
 * Refilling the naira float (D-068). When the vend partner's balance drops below the low-water mark, charged USDC on
 * the spender is sold through Paycrest on Base, paid straight into the partner's funding account.
 * Each step is saved before it acts: the order (by reference) before calling Paycrest, the transfer (by hash) before
 * sending it. One off-ramp in flight at a time.
 */
import { STABLES } from "@constant/chains";
import { insertOfframp, offrampInFlight, raiseOpsAlertOnce, updateOfframp } from "@constant/db";
import type { Offramp, OfframpRecipient, RateSource } from "@constant/partners";
import { decideFloatRefill, parseRate } from "@constant/rules";
import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import { REBROADCAST_AFTER_MIN, type DollarDeps } from "./dollars.js";
import type { Deps } from "./jobs.js";

export interface OfframpDeps {
  offramp: Offramp;
  rates: RateSource;
  recipient: OfframpRecipient;
  lowWaterMinor: bigint;
  targetMinor: bigint;
  minOrderMicro: bigint;
}

const MIN = 60_000;
const USDC_BASE = STABLES.find((s) => s.key === "base-usdc")!;

export async function refillFloat(d: Deps, dd: DollarDeps, od: OfframpDeps): Promise<string> {
  const now = d.now();
  const cur = await offrampInFlight(d.db);
  const ref = cur ? { reference: cur.reference } : null;

  if (cur && ref) {
    const age = now.getTime() - cur.updated_at.getTime();
    switch (cur.status) {
      case "creating":
        // Crashed between saving and Paycrest answering. Nothing was sent; an unfunded order just expires there.
        if (age > 10 * MIN) await updateOfframp(d.db, ref, { status: "failed", error: "no answer when creating the order" });
        return "creating";
      case "created": {
        const prepared = await dd.chain.prepareTransfer(USDC_BASE.address, cur.receive_address as Hex, BigInt(cur.send_micro!));
        await updateOfframp(d.db, ref, { status: "funding", tx_hash: prepared.hash, tx_raw: prepared.raw });
        await dd.chain.broadcast(prepared.raw);
        return "funding";
      }
      case "funding": {
        const st = await dd.chain.status(cur.tx_hash as Hex, dd.confirmations);
        if (st === "confirmed") {
          await updateOfframp(d.db, ref, { status: "funded", tx_raw: null });
          return "funded";
        }
        if (st === "reverted") {
          await updateOfframp(d.db, ref, { status: "failed", error: "transfer reverted", tx_raw: null });
          await raiseOpsAlertOnce(d.db, "page", "offramp_failed", `offramp:${cur.reference}`, { reference: cur.reference, txHash: cur.tx_hash });
          return "failed";
        }
        if (age > REBROADCAST_AFTER_MIN * MIN && cur.tx_raw) await dd.chain.broadcast(cur.tx_raw as Hex);
        return "funding";
      }
      case "funded": {
        const st = await od.offramp.orderStatus(cur.provider_order!).catch(() => "pending" as const);
        if (st === "settled") await updateOfframp(d.db, ref, { status: "settled" });
        else if (st === "refunded") {
          // The USDC comes back to the spender (returnAddress); a person checks why.
          await updateOfframp(d.db, ref, { status: "refunded" });
          await raiseOpsAlertOnce(d.db, "warn", "offramp_refunded", `refunded:${cur.reference}`, { reference: cur.reference });
        } else if (st === "expired") {
          await updateOfframp(d.db, ref, { status: "expired" });
          await raiseOpsAlertOnce(d.db, "page", "offramp_expired_after_funding", `expired:${cur.reference}`, { reference: cur.reference, txHash: cur.tx_hash });
        } else if (age > 6 * 60 * MIN) {
          await raiseOpsAlertOnce(d.db, "page", "offramp_slow", `slow:${cur.reference}`, { reference: cur.reference });
        }
        return st;
      }
      default:
        return cur.status;
    }
  }

  const [floatMinor, spenderMicro, quote] = await Promise.all([
    d.vending.floatBalance().catch(() => null),
    dd.chain.balanceOf(USDC_BASE.address, dd.chain.spender),
    od.rates.usdcToNgn(100).catch(() => null),
  ]);
  // Paycrest adds its fees on top of the order: leave room for them (1%, at least $1).
  const feeRoom = spenderMicro / 100n > 1_000_000n ? spenderMicro / 100n : 1_000_000n;
  const decision = decideFloatRefill({
    floatMinor,
    lowWaterMinor: od.lowWaterMinor,
    targetMinor: od.targetMinor,
    spenderMicro: spenderMicro > feeRoom ? spenderMicro - feeRoom : 0n,
    minOrderMicro: od.minOrderMicro,
    koboPerUsdc: quote ? parseRate(quote.ngnPerUsdc) : null,
    offrampInFlight: false,
  });
  if (decision.kind === "none") return decision.reason;

  const reference = `ofr_${randomUUID().replace(/-/g, "")}`;
  if (!(await insertOfframp(d.db, { provider: "paycrest", reference, amountMicro: decision.usdcMicro, rate: quote!.ngnPerUsdc }))) return "in_flight";
  try {
    const order = await od.offramp.createOrder({ amountMicro: decision.usdcMicro, rate: quote!.ngnPerUsdc, reference, returnAddress: dd.chain.spender, recipient: od.recipient });
    // Paycrest adds its fees on top; we must still hold enough to send it all.
    if (order.sendMicro > spenderMicro) {
      await updateOfframp(d.db, { reference }, { status: "failed", provider_order: order.id, error: "fees exceed the spender's balance" });
      return "too_small";
    }
    await updateOfframp(d.db, { reference }, { status: "created", provider_order: order.id, send_micro: order.sendMicro.toString(), receive_address: order.receiveAddress, valid_until: order.validUntil });
    d.log.info("offramp order created", { reference, amountMicro: decision.usdcMicro.toString() });
    return "created";
  } catch (err) {
    await updateOfframp(d.db, { reference }, { status: "failed", error: (err as Error).message.slice(0, 300) });
    return "failed";
  }
}
