import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { KIND_PRICES, MIN_AUTOPAY_MINOR, PAYSTACK_LOCAL, TOPUP_MAX_MINOR, TOPUP_MIN_MINOR, billFee, feeForKind, paystackFee, topUpCharge } from "../src/index.js";

const naira = (n: number) => BigInt(n) * 100n;

describe("pricing", () => {
  it("one fee per delivered bill: data ₦50, airtime ₦30, cable ₦100, electricity ₦100 (D-077)", () => {
    expect(KIND_PRICES.map((k) => k.kind).sort()).toEqual(["airtime", "data", "electricity", "tv"]);
    expect(feeForKind("data")).toBe(naira(50));
    expect(feeForKind("airtime")).toBe(naira(30));
    expect(feeForKind("tv")).toBe(naira(100));
    expect(feeForKind("electricity")).toBe(naira(100));
  });

  it("the first delivered payment on an account is free, and nothing stacks on the bill's fee", () => {
    expect(billFee("tv", true)).toBe(0n);
    expect(billFee("electricity", true)).toBe(0n);
    expect(billFee("tv", false)).toBe(naira(100));
    expect(billFee("electricity", false)).toBe(naira(100));
    expect(billFee("airtime", false)).toBe(naira(30));
  });

  it("data and airtime autopay start at ₦500", () => {
    expect(MIN_AUTOPAY_MINOR).toEqual({ data: naira(500), airtime: naira(500) });
  });

  it("Paystack's fee: 1.5%, plus ₦100 from ₦2,500, capped at ₦2,000", () => {
    expect(paystackFee(naira(1_000))).toBe(naira(15));
    expect(paystackFee(naira(2_499))).toBe(3_749n); // 1.5% of ₦2,499 rounded up, no ₦100
    expect(paystackFee(naira(2_500))).toBe(13_750n); // ₦37.50 + ₦100
    expect(paystackFee(naira(10_000))).toBe(naira(250));
    expect(paystackFee(naira(1_000_000))).toBe(PAYSTACK_LOCAL.capMinor);
    expect(paystackFee(0n)).toBe(0n);
  });

  it("known top-ups", () => {
    expect(topUpCharge(naira(1_000))).toEqual({ creditMinor: naira(1_000), feeMinor: 1_523n, totalMinor: 101_523n });
    expect(topUpCharge(naira(10_000)).totalMinor).toBe(1_025_381n); // ₦10,253.81: ₦153.81 (1.5%, rounded up) + ₦100
    expect(topUpCharge(naira(200_000)).feeMinor).toBe(PAYSTACK_LOCAL.capMinor);
  });

  it("a top-up always lands in full, and never collects more than one kobo above what it must", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: TOPUP_MIN_MINOR, max: TOPUP_MAX_MINOR }), (credit) => {
        const t = topUpCharge(credit);
        expect(t.totalMinor).toBe(t.creditMinor + t.feeMinor);
        expect(t.totalMinor - paystackFee(t.totalMinor)).toBeGreaterThanOrEqual(credit); // lands in full
        const less = t.totalMinor - 1n;
        expect(less - paystackFee(less)).toBeLessThan(credit); // the smallest total that does
        expect(t.feeMinor).toBeLessThanOrEqual(PAYSTACK_LOCAL.capMinor); // never above Paystack's cap
      }),
      { numRuns: 2_000 },
    );
  });

  it("rejects a non-positive top-up", () => {
    expect(() => topUpCharge(0n)).toThrow();
  });
});
