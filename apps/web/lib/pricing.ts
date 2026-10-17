import { KIND_PRICES, PRICING_FACTS, TOPUP_MAX_MINOR, TOPUP_MIN_MINOR, feeForKind, topUpCharge, type PricedKind } from "@constant/rules";

/**
 * What the pricing page and /llms.txt show, built from @constant/rules (D-075): the same table the database seed is
 * tested against, so the published prices can't drift from what is charged.
 */
export function ngn(minor: bigint): string {
  const kobo = minor % 100n;
  const whole = (minor / 100n).toLocaleString("en-NG");
  return kobo === 0n ? `₦${whole}` : `₦${whole}.${kobo.toString().padStart(2, "0")}`;
}

export const BILL_PRICES = KIND_PRICES.map((k) => ({
  kind: k.kind,
  label: k.label,
  fee: ngn(k.feeMinor),
  basis: k.basis,
}));

/**
 * The fee line shown when someone adds a bill (D-077): what each delivered payment of it costs, and, before they
 * have any bill, that the first delivered payment is free. Nothing for kinds ConstantUnits can't pay yet.
 */
const WHEN: Record<string, string> = {
  data: "only if the bundle lands",
  airtime: "only if it lands",
  tv: "only if the decoder is renewed",
  electricity: "only if the token arrives",
};
export function feeNote(kind: string, isFirst: boolean): string {
  if (!KIND_PRICES.some((k) => k.kind === kind)) return "";
  const each = `${ngn(feeForKind(kind as PricedKind))} per payment, ${WHEN[kind]}.`;
  return isFirst ? `${each} Your first delivered payment on ConstantUnits is free.` : each;
}

export const TOPUP_EXAMPLES = [1_000n, 5_000n, 10_000n, 50_000n].map((n) => {
  const t = topUpCharge(n * 100n);
  return { credit: ngn(t.creditMinor), fee: ngn(t.feeMinor), total: ngn(t.totalMinor) };
});

export const TOPUP_RANGE = `${ngn(TOPUP_MIN_MINOR)} to ${ngn(TOPUP_MAX_MINOR)}`;

export const FACTS = Object.values(PRICING_FACTS);
