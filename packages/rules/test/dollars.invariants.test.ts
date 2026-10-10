/**
 * Paying naira bills from USDC on Base (D-063): INV-45, INV-62 to INV-64.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_RATE_AGE_MS,
  USDC_UNIT,
  decideDollarRenewal,
  parseRate,
  permissionAllowance,
  usdcForNaira,
  type DollarRenewalInput,
} from "../src/index.js";

const NOW = new Date("2026-11-14T06:00:00Z");
const RATE = 135_234n; // ₦1,352.34 per USDC

const base = (over: Partial<DollarRenewalInput> = {}): DollarRenewalInput => ({
  vendingEnabled: true,
  status: "active",
  verified: true,
  runAt: NOW,
  now: NOW,
  quote: { amountMinor: 1_995_000n, dueAt: new Date("2026-11-15T06:00:00Z") },
  capMinor: 2_500_000n,
  feeMinor: 0n,
  hasOpenOrder: false,
  lastRenewedAt: null,
  permission: { status: "approved", remainingThisPeriod: 20_000_000n, endsAt: NOW.getTime() / 1000 + 86_400 },
  rate: { koboPerUsdc: RATE, fetchedAt: new Date(NOW.getTime() - 60_000) },
  walletMicro: 50_000_000n,
  ...over,
});

describe("conversion", () => {
  it("parses rates exactly", () => {
    expect(parseRate("1352.34")).toBe(135_234n);
    expect(parseRate("1500")).toBe(150_000n);
    expect(parseRate("1352.349")).toBe(135_234n);
    expect(() => parseRate("-1")).toThrow();
    expect(() => parseRate("0")).toThrow();
    expect(() => parseRate("1e3")).toThrow();
  });

  it("INV-62: the USDC charged always covers the naira price, by less than one micro-unit", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 7n }), (naira, rate) => {
        const usdc = usdcForNaira(naira, rate);
        expect(usdc * rate >= naira * USDC_UNIT).toBe(true);
        expect((usdc - 1n) * rate < naira * USDC_UNIT || usdc === 0n).toBe(true);
      }),
    );
  });

  it("the allowance covers the limit plus the buffer, in whole cents", () => {
    const a = permissionAllowance(2_500_000n, RATE);
    expect(a % 10_000n).toBe(0n);
    expect(a).toBeGreaterThanOrEqual(usdcForNaira(2_500_000n, RATE));
    expect(a).toBe(19_970_000n); // ₦25,000 at ₦1,352.34 = $18.49 + 8% → $19.97
  });
});

describe("decideDollarRenewal", () => {
  it("charges the naira price converted at the fresh rate", () => {
    expect(decideDollarRenewal(base())).toEqual({ kind: "charge", amountMinor: 1_995_000n, feeMinor: 0n, usdcMicro: usdcForNaira(1_995_000n, RATE), koboPerUsdc: RATE });
  });

  it("keeps every naira rule first: paused, above the naira limit, renewed elsewhere", () => {
    expect(decideDollarRenewal(base({ status: "paused" }))).toEqual({ kind: "do_not_renew", reason: "paused" });
    expect(decideDollarRenewal(base({ capMinor: 1_000_000n }))).toEqual({ kind: "do_not_renew", reason: "above_cap" });
    expect(decideDollarRenewal(base({ vendingEnabled: false }))).toEqual({ kind: "do_not_renew", reason: "killed" });
  });

  it.each([
    ["no_permission", { permission: null }],
    ["no_permission", { permission: { status: "signed" as const, remainingThisPeriod: 10n ** 9n, endsAt: 2e9 } }],
    ["no_permission", { permission: { status: "revoke_pending" as const, remainingThisPeriod: 10n ** 9n, endsAt: 2e9 } }],
    ["permission_expired", { permission: { status: "approved" as const, remainingThisPeriod: 10n ** 9n, endsAt: NOW.getTime() / 1000 } }],
    ["rate_stale", { rate: { koboPerUsdc: RATE, fetchedAt: new Date(NOW.getTime() - MAX_RATE_AGE_MS - 1) } }],
    ["rate_stale", { rate: null }],
    ["allowance_used", { permission: { status: "approved" as const, remainingThisPeriod: 1_000_000n, endsAt: 2e9 } }],
    ["wallet_short", { walletMicro: 14_000_000n }],
  ])("%s", (reason, over) => {
    expect(decideDollarRenewal(base(over as Partial<DollarRenewalInput>)).kind).toBe("do_not_renew");
    expect((decideDollarRenewal(base(over as Partial<DollarRenewalInput>)) as { reason: string }).reason).toBe(reason);
  });

  it("INV-45 / INV-63: a charge never exceeds what the permission has left or what the account holds", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.bigInt({ min: 50_000n, max: 500_000n }),
        (price, remaining, wallet, rate) => {
          const d = decideDollarRenewal(
            base({
              quote: { amountMinor: price, dueAt: null },
              capMinor: 10n ** 10n,
              permission: { status: "approved", remainingThisPeriod: remaining, endsAt: 2e9 },
              walletMicro: wallet,
              rate: { koboPerUsdc: rate, fetchedAt: NOW },
            }),
          );
          if (d.kind === "charge") {
            expect(d.usdcMicro <= remaining).toBe(true);
            expect(d.usdcMicro <= wallet).toBe(true);
            expect(d.usdcMicro * rate >= (d.amountMinor + d.feeMinor) * USDC_UNIT).toBe(true);
          }
        },
      ),
    );
  });
});
