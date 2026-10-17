import { AUTOPAY, KIND_PRICES, PRICING_FACTS, TOPUP_MAX_MINOR, TOPUP_MIN_MINOR, feeForKind, topUpCharge, type PricedKind } from "@constant/rules";

/**
 * What the pricing page and /llms.txt show, built from @constant/rules (D-075): the same table the database seed is
 * tested against, so the published prices can't drift from what is charged.
 */
export function ngn(minor: bigint): string {
  const kobo = minor % 100n;
  const whole = (minor / 100n).toLocaleString("en-NG");
  return kobo === 0n ? `₦${whole}` : `₦${whole}.${kobo.toString().padStart(2, "0")}`;
}

export const AUTOPAY_FEE = ngn(AUTOPAY.feeMinor);

export const BILL_PRICES = KIND_PRICES.map((k) => ({
  kind: k.kind,
  label: k.label,
  fee: k.feeMinor === 0n ? "No extra fee" : `${ngn(k.feeMinor)} per token`,
  basis: k.basis,
}));

/**
 * The fee line shown when someone adds a bill (D-076): what each automatic payment of this bill will cost on top,
 * given whether it's their first bill on autopay. Subscriptions have no per-kind fee yet.
 */
export function feeNote(kind: string, isFirst: boolean): string {
  const kindFee = (KIND_PRICES.some((k) => k.kind === kind) ? feeForKind(kind as PricedKind) : 0n);
  const kindPart = kindFee > 0n ? `${ngn(kindFee)} per token` : "";
  if (isFirst) {
    return kindPart
      ? `Your first bill on autopay has no autopay fee; electricity is ${kindPart}, only when delivered.`
      : "Your first bill on autopay is free: no fee on its payments.";
  }
  const total = ngn(kindFee + AUTOPAY.feeMinor);
  return kindPart
    ? `${total} per token (${AUTOPAY_FEE} autopay + ${kindPart}), only when delivered.`
    : `${AUTOPAY_FEE} autopay fee per payment, only when delivered.`;
}

export const TOPUP_EXAMPLES = [1_000n, 5_000n, 10_000n, 50_000n].map((n) => {
  const t = topUpCharge(n * 100n);
  return { credit: ngn(t.creditMinor), fee: ngn(t.feeMinor), total: ngn(t.totalMinor) };
});

export const TOPUP_RANGE = `${ngn(TOPUP_MIN_MINOR)} to ${ngn(TOPUP_MAX_MINOR)}`;

export const FACTS = Object.values(PRICING_FACTS);
