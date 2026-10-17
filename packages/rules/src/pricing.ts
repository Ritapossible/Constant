/**
 * ConstantUnits's prices, in one place (D-075, D-077). The `fees` table seed, the pricing page and /llms.txt all come from
 * this file, and a database test fails if the seed and this table disagree, so what people read can't drift from
 * what they are charged.
 */
import type { Minor } from "./types.js";

export type PricedKind = "data" | "airtime" | "electricity" | "tv";

export interface KindPrice {
  kind: PricedKind;
  label: string;
  /** ConstantUnits's fee per successful payment, in kobo. Zero means sold at face value. */
  feeMinor: Minor;
  /** How ConstantUnits earns on it, in plain words. */
  basis: string;
}

/**
 * One fee per delivered bill, on top of its face value (D-077). Nothing stacks on it, and nothing is charged when
 * the bill fails or is reversed. The `fees` table must match: packages/db/test checks it.
 */
export const KIND_PRICES: readonly KindPrice[] = [
  { kind: "data", label: "Data", feeMinor: 5_000n, basis: "Only if the bundle lands." },
  { kind: "airtime", label: "Airtime", feeMinor: 3_000n, basis: "Only on ₦500 or more, and only if it lands." },
  { kind: "tv", label: "Cable TV", feeMinor: 10_000n, basis: "Only if the decoder is renewed." },
  { kind: "electricity", label: "Electricity", feeMinor: 10_000n, basis: "Only if the token arrives." },
];

/** Data and airtime are paid automatically only from ₦500: below that the fee would be too large a share (D-077). */
export const MIN_AUTOPAY_MINOR: Partial<Record<PricedKind, Minor>> = { data: 50_000n, airtime: 50_000n };

export function feeForKind(kind: PricedKind): Minor {
  const p = KIND_PRICES.find((k) => k.kind === kind);
  if (!p) throw new Error(`no price for ${kind}`);
  return p.feeMinor;
}

/**
 * What one delivered payment costs on top of the bill (D-077): the kind's fee, or nothing when it is the first
 * payment on a new account (once per person, not per bill).
 */
export function billFee(kind: PricedKind, isFirstPayment: boolean): Minor {
  return isFirstPayment ? 0n : feeForKind(kind);
}

/**
 * Paystack's published local-payment fee (Nigeria): 1.5% + ₦100, the ₦100 waived under ₦2,500, capped at ₦2,000.
 * Card, USSD and QR top-ups pass this on at cost, shown before paying; ConstantUnits adds nothing. A transfer to
 * the user's own account number costs them nothing. Re-check against paystack.com/pricing when it changes.
 */
export const PAYSTACK_LOCAL = {
  bps: 150n,
  flatMinor: 10_000n,
  flatWaivedBelowMinor: 250_000n,
  capMinor: 200_000n,
} as const;

/** Smallest and largest card/USSD/QR top-up, in kobo. */
export const TOPUP_MIN_MINOR = 100_000n; // ₦1,000
export const TOPUP_MAX_MINOR = 50_000_000n; // ₦500,000

/** Paystack's fee on a charge of `totalMinor` kobo. */
export function paystackFee(totalMinor: Minor): Minor {
  if (totalMinor <= 0n) return 0n;
  const pct = (totalMinor * PAYSTACK_LOCAL.bps + 9_999n) / 10_000n; // rounded up: never under-collect
  const flat = totalMinor < PAYSTACK_LOCAL.flatWaivedBelowMinor ? 0n : PAYSTACK_LOCAL.flatMinor;
  const fee = pct + flat;
  return fee > PAYSTACK_LOCAL.capMinor ? PAYSTACK_LOCAL.capMinor : fee;
}

/**
 * What to charge so that, after Paystack's fee, `creditMinor` reaches the user's balance in full. The smallest
 * total that covers it: the fee is passed on at cost, never marked up.
 */
export function topUpCharge(creditMinor: Minor): { creditMinor: Minor; feeMinor: Minor; totalMinor: Minor } {
  if (creditMinor <= 0n) throw new Error("top-up must be positive");
  let total = creditMinor;
  // The fee grows with the total, so iterate to the fixed point (two or three steps).
  for (let i = 0; i < 10; i++) {
    const next = creditMinor + paystackFee(total);
    if (next === total) break;
    total = next;
  }
  // Walk down while a smaller total still covers the credit (the ₦100 waiver can make that possible).
  while (total - 1n >= creditMinor && total - 1n - paystackFee(total - 1n) >= creditMinor) total -= 1n;
  return { creditMinor, feeMinor: total - creditMinor, totalMinor: total };
}

/** Facts for the pricing page and /llms.txt. Each one must stay true; change the code first, then this. */
export const PRICING_FACTS = {
  noSubscription: "No subscription and no monthly fee.",
  firstFree: "The first delivered payment on a new account is free.",
  bankTransferFree: "Adding money by bank transfer, from any Nigerian bank app to your own ConstantUnits account number, is free.",
  cardAtCost: "Card, USSD and QR top-ups add the card processor's fee at cost, shown before you pay.",
  failedRefunded: "If a bill isn't delivered, you pay nothing, fee included. If a payment is refunded, the fee is refunded with it.",
  potsKeep: "Money in a pot stays there until it pays that bill or you move it. It doesn't expire.",
  stablesSame: "Paying from USDC or USDT costs the same naira fee, at the market rate, with no spread added.",
} as const;
