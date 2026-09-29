/**
 * Schedule-mode invariants from docs/INVARIANTS.md. Each describe names its number.
 * If one of these fails, money moved when it should not have, or light went out
 * when it should not have.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  decideSchedule,
  effectiveWeeklyCap,
  nextRunAfterBuy,
  scanAction,
  type ScheduleDecisionInput,
} from "../src/index.js";
import { LAGOS, MON_0700, dueSite, hoursAfter, lowRequest, naira } from "./fixtures.js";

const buys = (i: ScheduleDecisionInput) => decideSchedule(i).kind === "buy";
const reason = (i: ScheduleDecisionInput) => {
  const d = decideSchedule(i);
  return d.kind === "do_not_buy" ? d.reason : "buy";
};

describe("INV-1 a scheduled buy needs every precondition", () => {
  it("buys the fixed amount when everything holds", () => {
    expect(decideSchedule(dueSite())).toEqual({ kind: "buy", amountMinor: naira(15_000) });
  });

  it.each<[string, Partial<ScheduleDecisionInput>, string]>([
    ["not due yet", { scheduledFor: hoursAfter(MON_0700, 1) }, "not_due"],
    ["no next_run_at", { scheduledFor: null }, "not_due"],
    ["alert mode", { mode: "alert" }, "not_schedule"],
    ["unverified meter", { verified: false }, "unverified"],
    ["frozen", { frozen: true }, "frozen"],
    ["no buy amount", { buyAmountMinor: null }, "misconfigured"],
    ["zero buy amount", { buyAmountMinor: 0n }, "misconfigured"],
    ["short balance", { balanceMinor: naira(4_000) }, "insufficient"],
    ["over weekly cap", { weeklySpentMinor: naira(15_000) }, "weekly_cap"],
    ["inside min gap", { lastBuyAt: hoursAfter(MON_0700, -19) }, "too_soon"],
    ["kill switch", { vendingEnabled: false }, "killed"],
  ])("does not buy when %s", (_name, over, expected) => {
    expect(reason(dueSite(over))).toBe(expected);
  });

  it("property: any buy implies every precondition held", () => {
    fc.assert(
      fc.property(
        fc.record({
          mode: fc.constantFrom("schedule" as const, "alert" as const),
          verified: fc.boolean(),
          frozen: fc.boolean(),
          vendingEnabled: fc.boolean(),
          hasOpenOrder: fc.boolean(),
          balance: fc.bigInt({ min: 0n, max: naira(200_000) }),
          amount: fc.bigInt({ min: 1n, max: naira(100_000) }),
          spent: fc.bigInt({ min: 0n, max: naira(200_000) }),
          cap: fc.bigInt({ min: 0n, max: naira(200_000) }),
          sinceLastH: fc.option(fc.integer({ min: 0, max: 200 })),
          minH: fc.integer({ min: 0, max: 72 }),
          dueOffsetMin: fc.integer({ min: -600, max: 600 }),
        }),
        (r) => {
          const now = MON_0700;
          const i = dueSite({
            mode: r.mode,
            verified: r.verified,
            frozen: r.frozen,
            vendingEnabled: r.vendingEnabled,
            hasOpenOrder: r.hasOpenOrder,
            balanceMinor: r.balance,
            buyAmountMinor: r.amount,
            weeklySpentMinor: r.spent,
            weeklyCapMinor: r.cap,
            lastBuyAt: r.sinceLastH === null ? null : hoursAfter(now, -r.sinceLastH),
            minHoursBetweenBuys: r.minH,
            scheduledFor: new Date(now.getTime() + r.dueOffsetMin * 60_000),
          });
          const d = decideSchedule(i);
          if (d.kind !== "buy") return;
          expect(d.amountMinor).toBe(r.amount);
          expect(r.mode).toBe("schedule");
          expect(r.verified && !r.frozen && r.vendingEnabled && !r.hasOpenOrder).toBe(true);
          expect(r.dueOffsetMin).toBeLessThanOrEqual(0);
          expect(r.balance >= r.amount).toBe(true);
          expect(r.spent + r.amount <= r.cap).toBe(true);
          if (r.sinceLastH !== null) expect(r.sinceLastH).toBeGreaterThanOrEqual(r.minH);
        },
      ),
    );
  });
});

describe("INV-2 / INV-3 silence neither cancels nor creates a buy", () => {
  it("the decision has no input for 'last reply', so silence cannot matter", () => {
    // Structural: ScheduleDecisionInput has no field for inbound activity.
    const keys = Object.keys(dueSite());
    expect(keys.some((k) => /reply|inbound|silence|message|reading|units/i.test(k))).toBe(false);
  });

  it("a week of silence: the next Monday still buys", () => {
    const nextMonday = hoursAfter(MON_0700, 24 * 7);
    expect(buys(dueSite({ now: nextMonday, scheduledFor: nextMonday, lastBuyAt: MON_0700 }))).toBe(true);
  });

  it("silence does not buy before the slot", () => {
    expect(reason(dueSite({ now: hoursAfter(MON_0700, -1) }))).toBe("not_due");
  });
});

describe("INV-4 a frozen site does not buy", () => {
  it("on schedule or on LOW", () => {
    expect(buys(dueSite({ frozen: true }))).toBe(false);
    expect(buys(lowRequest({ frozen: true }))).toBe(false);
  });
});

describe("INV-5 no buy above balance or weekly cap", () => {
  it("exactly the balance buys; one kobo short does not", () => {
    expect(buys(dueSite({ balanceMinor: naira(15_000) }))).toBe(true);
    expect(reason(dueSite({ balanceMinor: naira(15_000) - 1n }))).toBe("insufficient");
  });

  it("reaching the cap exactly buys; one kobo over does not", () => {
    expect(buys(dueSite({ weeklyCapMinor: naira(15_000) }))).toBe(true);
    expect(reason(dueSite({ weeklyCapMinor: naira(15_000) - 1n }))).toBe("weekly_cap");
  });

  it("default cap is amount times distinct chosen days", () => {
    expect(effectiveWeeklyCap(null, naira(15_000), [1, 4])).toBe(naira(30_000));
    expect(effectiveWeeklyCap(null, naira(15_000), [1, 1, 4])).toBe(naira(30_000));
    expect(effectiveWeeklyCap(naira(10_000), naira(15_000), [1, 4])).toBe(naira(10_000));
  });
});

describe("INV-6 two runs inside the min gap do not buy twice (scheduler and LOW share it)", () => {
  it("LOW 19h after a scheduled buy does not buy", () => {
    expect(reason(lowRequest({ now: hoursAfter(MON_0700, 19), lastBuyAt: MON_0700 }))).toBe("too_soon");
  });

  it("LOW 20h after buys", () => {
    expect(buys(lowRequest({ now: hoursAfter(MON_0700, 20), lastBuyAt: MON_0700 }))).toBe(true);
  });

  it("a scheduled run inside the gap after a LOW does not buy and simply advances", () => {
    const d = decideSchedule(dueSite({ lastBuyAt: hoursAfter(MON_0700, -2) }));
    expect(d).toEqual({ kind: "do_not_buy", reason: "too_soon" });
    expect(scanAction(d)).toEqual({ kind: "advance" });
  });

  it("an open order blocks a second buy even before last_buy_at is written", () => {
    // The race the original spec left open: the scheduled vend is still with
    // the partner, so last_buy_at and the ledger are unchanged, and a LOW lands.
    expect(reason(lowRequest({ hasOpenOrder: true, lastBuyAt: null }))).toBe("in_flight");
    expect(scanAction(decideSchedule(dueSite({ hasOpenOrder: true })))).toEqual({ kind: "hold" });
  });
});

describe("INV-9 SKIP cancels only the next run", () => {
  it("the skipped run advances without buying and without freezing", () => {
    const d = decideSchedule(dueSite({ skipped: true }));
    expect(d).toEqual({ kind: "do_not_buy", reason: "skipped" });
    expect(scanAction(d)).toEqual({ kind: "advance" });
  });

  it("the run after a skip buys", () => {
    const next = hoursAfter(MON_0700, 24 * 7);
    expect(buys(dueSite({ now: next, scheduledFor: next, skipped: false }))).toBe(true);
  });

  it("skip does not affect LOW", () => {
    expect(buys(lowRequest({ skipped: true }))).toBe(true);
  });
});

describe("INV-12 a reconciliation mismatch stops every buy", () => {
  it("kill switch wins over everything and holds the run", () => {
    const d = decideSchedule(dueSite({ vendingEnabled: false }));
    expect(d).toEqual({ kind: "do_not_buy", reason: "killed" });
    expect(scanAction(d)).toEqual({ kind: "hold" });
    expect(buys(lowRequest({ vendingEnabled: false }))).toBe(false);
  });
});

describe("INV-19 a scheduled buy does not wait for a unit reading", () => {
  it("buys with no reading ever received", () => {
    expect(buys(dueSite())).toBe(true);
  });
});

describe("no catch-up buys", () => {
  it("a run left over from yesterday is stale and tells the owner once", () => {
    const tuesday = hoursAfter(MON_0700, 24);
    const d = decideSchedule(dueSite({ now: tuesday }));
    expect(d).toEqual({ kind: "do_not_buy", reason: "stale" });
    expect(scanAction(d)).toEqual({ kind: "advance_and_notify", notice: "missed" });
  });

  it("a run late on the same local day still buys", () => {
    expect(buys(dueSite({ now: hoursAfter(MON_0700, 15) }))).toBe(true); // 22:00 Lagos
  });

  it("the day boundary is Lagos midnight, not UTC midnight", () => {
    // 23:30Z Monday is 00:30 Tuesday in Lagos.
    expect(reason(dueSite({ now: new Date("2026-10-05T23:30:00Z") }))).toBe("stale");
    // 22:30Z Monday is 23:30 Monday in Lagos.
    expect(buys(dueSite({ now: new Date("2026-10-05T22:30:00Z") }))).toBe(true);
  });
});

describe("short balance notifies once, then moves on", () => {
  it("advances next_run_at so the scan does not notify every minute", () => {
    const d = decideSchedule(dueSite({ balanceMinor: naira(4_000) }));
    expect(scanAction(d)).toEqual({ kind: "advance_and_notify", notice: "insufficient" });
  });
});

describe("LOW after a buy moves the next run past the gap", () => {
  const schedule = { weekdays: [1, 4] as const, runMinuteLocal: 420, timeZone: LAGOS };

  it("LOW on Sunday 15:00 does not make Monday 07:00 fall inside the gap", () => {
    const sunday1500 = new Date("2026-10-04T14:00:00Z");
    // Monday 07:00 is only 16h later. The next run must be Thursday.
    expect(nextRunAfterBuy(sunday1500, schedule, 20).toISOString()).toBe("2026-10-08T06:00:00.000Z");
  });

  it("scheduled Monday buy moves to Thursday", () => {
    expect(nextRunAfterBuy(MON_0700, schedule, 20).toISOString()).toBe("2026-10-08T06:00:00.000Z");
  });
});
