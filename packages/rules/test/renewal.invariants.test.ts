/**
 * Cable renewals (D-041): INV-38, 39, 50 to 53.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  availableBalance,
  decideRenewal,
  localParts,
  nextDueAfter,
  renewalAction,
  renewalOrderKey,
  renewalRunAt,
  type RenewalInput,
} from "../src/index.js";

const TZ = "Africa/Lagos";
const NOW = new Date("2026-11-14T06:00:00Z"); // 07:00 Lagos
const DUE = new Date("2026-11-15T06:00:00Z");

const base = (over: Partial<RenewalInput> = {}): RenewalInput => ({
  vendingEnabled: true,
  status: "active",
  verified: true,
  runAt: NOW,
  now: NOW,
  quote: { amountMinor: 1_995_000n, dueAt: DUE },
  capMinor: 2_500_000n,
  feeMinor: 0n,
  availableMinor: 5_000_000n,
  hasOpenOrder: false,
  lastRenewedAt: null,
  ...over,
});

describe("decideRenewal", () => {
  it("renews the quoted amount when everything holds", () => {
    expect(decideRenewal(base())).toEqual({ kind: "renew", amountMinor: 1_995_000n, feeMinor: 0n });
  });

  it.each([
    ["killed", { vendingEnabled: false }],
    ["cancelled", { status: "cancelled" as const }],
    ["paused", { status: "paused" as const }],
    ["frozen", { status: "frozen" as const }],
    ["unverified", { verified: false }],
    ["not_due", { runAt: new Date(NOW.getTime() + 60_000) }],
    ["in_flight", { hasOpenOrder: true }],
    ["too_soon", { lastRenewedAt: new Date(NOW.getTime() - 5 * DAY_MS) }],
    ["no_quote", { quote: null }],
    ["already_renewed", { quote: { amountMinor: 1_995_000n, dueAt: new Date(NOW.getTime() + 25 * DAY_MS) } }],
    ["above_cap", { capMinor: 1_994_999n }],
    ["insufficient", { availableMinor: 1_994_999n }],
    ["misconfigured", { quote: { amountMinor: 0n, dueAt: DUE } }],
  ])("%s", (reason, over) => {
    expect(decideRenewal(base(over as Partial<RenewalInput>))).toEqual({ kind: "do_not_renew", reason });
  });

  it("INV-38: no payment for a paused or cancelled line, whatever the money", () => {
    fc.assert(
      fc.property(fc.constantFrom("paused" as const, "cancelled" as const), fc.bigInt({ min: 0n, max: 10n ** 12n }), (status, available) => {
        expect(decideRenewal(base({ status, availableMinor: available })).kind).toBe("do_not_renew");
      }),
    );
  });

  it("INV-39: never pays above the cap; the amount is always the partner's quote", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 10n }),
        (quote, cap, available) => {
          const d = decideRenewal(base({ quote: { amountMinor: quote, dueAt: DUE }, capMinor: cap, availableMinor: available }));
          if (d.kind === "renew") {
            expect(d.amountMinor).toBe(quote);
            expect(d.amountMinor <= cap).toBe(true);
            expect(d.amountMinor + d.feeMinor <= available).toBe(true);
          }
        },
      ),
    );
  });

  it("INV-50: balance must cover amount plus fee, to the kobo", () => {
    expect(decideRenewal(base({ feeMinor: 10_000n, availableMinor: 2_004_999n })).kind).toBe("do_not_renew");
    expect(decideRenewal(base({ feeMinor: 10_000n, availableMinor: 2_005_000n })).kind).toBe("renew");
  });

  it("INV-51: a decoder renewed elsewhere is not paid again; the run moves to the day before its new end", () => {
    const later = new Date("2026-12-15T06:00:00Z");
    const input = base({ quote: { amountMinor: 1_995_000n, dueAt: later } });
    const d = decideRenewal(input);
    expect(d).toEqual({ kind: "do_not_renew", reason: "already_renewed" });
    expect(renewalAction(d, input, TZ)).toEqual({ kind: "reschedule", runAt: new Date("2026-12-14T06:00:00Z") });
  });
});

describe("renewalAction", () => {
  it("short money or a price above the cap: tell once, keep trying this cycle", () => {
    expect(renewalAction({ kind: "do_not_renew", reason: "insufficient" }, base(), TZ)).toEqual({ kind: "notify_and_hold", notice: "insufficient" });
    expect(renewalAction({ kind: "do_not_renew", reason: "above_cap" }, base(), TZ)).toEqual({ kind: "notify_and_hold", notice: "above_cap" });
  });

  it("too soon after a renewal: move to next month", () => {
    const r = renewalAction({ kind: "do_not_renew", reason: "too_soon" }, base(), TZ);
    expect(r.kind).toBe("reschedule");
    if (r.kind === "reschedule") expect(r.runAt.toISOString()).toBe("2026-12-13T06:00:00.000Z");
  });

  it.each(["killed", "paused", "frozen", "no_quote", "in_flight", "not_due"] as const)("%s holds", (reason) => {
    expect(renewalAction({ kind: "do_not_renew", reason }, base(), TZ)).toEqual({ kind: "hold" });
  });
});

describe("dates", () => {
  it("runs at 07:00 Lagos the day before the end", () => {
    const run = renewalRunAt(new Date("2026-11-15T22:30:00Z"), TZ); // 23:30 Lagos on the 15th
    const p = localParts(run, TZ);
    expect([p.day, p.hour, p.minute]).toEqual([14, 7, 0]);
  });

  it("next due is the same day next month, clamped to the month's end", () => {
    const jan31 = new Date("2027-01-31T06:00:00Z");
    expect(localParts(nextDueAfter(jan31, TZ), TZ).day).toBe(28);
    const dec10 = new Date("2026-12-10T06:00:00Z");
    const p = localParts(nextDueAfter(dec10, TZ), TZ);
    expect([p.year, p.month, p.day]).toEqual([2027, 1, 10]);
  });
});

describe("INV-52: money committed to open orders cannot be spent twice", () => {
  it("available = ledger - committed", () => {
    expect(availableBalance(5_000_000n, 1_995_000n)).toBe(3_005_000n);
    expect(() => availableBalance(1n, -1n)).toThrow();
  });
  it("one renewal key per line per cycle", () => {
    expect(renewalOrderKey("l1", DUE)).toBe(renewalOrderKey("l1", new Date(DUE.getTime())));
    expect(renewalOrderKey("l1", DUE)).not.toBe(renewalOrderKey("l2", DUE));
  });
});
