/**
 * Running-low probability, reminders and wallet runway (D-042, D-043; INV-33 to INV-36).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_REMINDER_POLICY,
  daysUntilRunOut,
  decideLowReminder,
  decideWithdrawal,
  runOutProbability,
  runOutWindow,
  usageStats,
  walletRunway,
  type LowReminderInput,
  type UsageStats,
} from "../src/index.js";
import { LAGOS, naira } from "./fixtures.js";

// About 1 GB a day of data, give or take 300 MB.
const dataUser: UsageStats = { meanPerDay: 1000, sdPerDay: 300, days: 14 };

describe("usageStats", () => {
  it("needs at least 3 days before it claims anything", () => {
    expect(usageStats([900, 1100])).toBeNull();
    expect(usageStats([900, 1000, 1100])).toEqual({ meanPerDay: 1000, sdPerDay: 100, days: 3 });
  });
  it("ignores impossible values", () => {
    expect(usageStats([900, Number.NaN, -5, 1000, 1100])?.days).toBe(3);
  });
});

describe("INV-33 running-low probability is a sane probability", () => {
  it("empty means certain; plenty means unlikely", () => {
    expect(runOutProbability(0, dataUser, 1)).toBe(1);
    expect(runOutProbability(50_000, dataUser, 2)).toBeLessThan(0.001);
  });

  it("about even when remaining equals expected use", () => {
    expect(runOutProbability(2000, dataUser, 2)).toBeCloseTo(0.5, 2);
  });

  it("property: always in [0,1], rises with time, falls with more remaining", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100_000, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0.1, max: 30, noNaN: true }),
        (remaining, mean, sd, h) => {
          const s = { meanPerDay: mean, sdPerDay: sd, days: 7 };
          const p = runOutProbability(remaining, s, h);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          expect(runOutProbability(remaining, s, h * 2)).toBeGreaterThanOrEqual(p - 1e-9);
          expect(runOutProbability(remaining * 2, s, h)).toBeLessThanOrEqual(p + 1e-9);
        },
      ),
    );
  });
});

describe("run-out window", () => {
  const now = new Date("2026-10-05T06:00:00Z");

  it("the cautious date comes before the likely date", () => {
    const w = runOutWindow(3000, dataUser, now);
    expect(w).not.toBeNull();
    expect(w!.early.getTime()).toBeLessThan(w!.likely.getTime());
    // 3 GB at ~1 GB/day: likely in about 3 days.
    expect(daysUntilRunOut(3000, dataUser, 0.5)).toBeCloseTo(3, 1);
  });

  it("no date when usage is zero", () => {
    expect(daysUntilRunOut(100, { meanPerDay: 0, sdPerDay: 0, days: 5 }, 0.5)).toBeNull();
  });
});

describe("INV-34 reminders are useful, not noise", () => {
  const policy = { ...DEFAULT_REMINDER_POLICY, timeZone: LAGOS };
  const noon = new Date("2026-10-05T11:00:00Z"); // 12:00 Lagos
  const base: LowReminderInput = {
    remaining: 1500,
    stats: dataUser,
    coveredByAutopilot: false,
    lastReminderAt: null,
    now: noon,
    policy,
  };

  it("reminds when running out within 48h is likely", () => {
    const d = decideLowReminder(base);
    expect(d.kind).toBe("remind");
    if (d.kind === "remind") expect(d.tone).toBe("act");
  });

  it("is only a heads-up when autopilot and the wallet have it covered", () => {
    const d = decideLowReminder({ ...base, coveredByAutopilot: true });
    expect(d.kind === "remind" && d.tone).toBe("heads_up");
  });

  it("stays quiet while still learning", () => {
    expect(decideLowReminder({ ...base, stats: null })).toEqual({ kind: "none", reason: "learning" });
  });

  it("stays quiet when running out is unlikely", () => {
    expect(decideLowReminder({ ...base, remaining: 20_000 })).toEqual({ kind: "none", reason: "unlikely" });
  });

  it("at most one per line per 24h", () => {
    const recent = new Date(noon.getTime() - 23 * 3_600_000);
    expect(decideLowReminder({ ...base, lastReminderAt: recent })).toEqual({ kind: "none", reason: "cooldown" });
    const older = new Date(noon.getTime() - 24 * 3_600_000);
    expect(decideLowReminder({ ...base, lastReminderAt: older }).kind).toBe("remind");
  });

  it("never between 22:00 and 07:00 local time", () => {
    const night = new Date("2026-10-05T22:30:00Z"); // 23:30 Lagos
    expect(decideLowReminder({ ...base, now: night })).toEqual({ kind: "none", reason: "quiet_hours" });
    const morning = new Date("2026-10-05T06:00:00Z"); // 07:00 Lagos
    expect(decideLowReminder({ ...base, now: morning }).kind).toBe("remind");
  });
});

describe("INV-35 wallet runway warns before a renewal fails", () => {
  const d = (iso: string) => new Date(iso);
  const charges = [
    { lineId: "dstv", at: d("2026-10-15T00:00:00Z"), amountMinor: naira(15_700), certainty: "scheduled" as const },
    { lineId: "data", at: d("2026-10-09T00:00:00Z"), amountMinor: naira(3_500), certainty: "estimated" as const },
    { lineId: "chatgpt", at: d("2026-10-20T00:00:00Z"), amountMinor: naira(32_000), certainty: "scheduled" as const },
  ];

  it("covered when the money set aside pays everything", () => {
    expect(walletRunway(naira(60_000), charges)).toEqual({ kind: "covered", through: d("2026-10-20T00:00:00Z") });
  });

  it("names the first charge that would fail, and by how much", () => {
    const r = walletRunway(naira(30_000), charges);
    expect(r.kind).toBe("short");
    if (r.kind === "short") {
      expect(r.firstUncovered.lineId).toBe("chatgpt");
      expect(r.shortfallMinor).toBe(naira(32_000) - (naira(30_000) - naira(3_500) - naira(15_700)));
      expect(r.coveredThrough).toEqual(d("2026-10-15T00:00:00Z"));
    }
  });

  it("nothing upcoming is covered", () => {
    expect(walletRunway(0n, [])).toEqual({ kind: "covered", through: null });
  });
});

describe("INV-36 withdraw any time, except money promised to an open order", () => {
  const ok = {
    balanceMinor: naira(50_000),
    committedMinor: naira(15_000),
    amountMinor: naira(35_000),
    payoutVerified: true,
    payoutsEnabled: true,
  };

  it("pays out everything not committed", () => {
    expect(decideWithdrawal(ok)).toEqual({ kind: "pay_out", amountMinor: naira(35_000) });
  });

  it.each([
    ["more than is free", { amountMinor: naira(35_001) }, "insufficient"],
    ["zero", { amountMinor: 0n }, "non_positive"],
    ["unverified bank account", { payoutVerified: false }, "unverified_payout"],
    ["payouts paused by reconciliation", { payoutsEnabled: false }, "paused"],
  ])("refuses %s", (_n, over, reason) => {
    const r = decideWithdrawal({ ...ok, ...over });
    expect(r.kind === "refuse" && r.reason).toBe(reason);
  });

  it("property: never pays out committed money", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: naira(1_000_000) }),
        fc.bigInt({ min: 0n, max: naira(1_000_000) }),
        fc.bigInt({ min: 1n, max: naira(1_000_000) }),
        (bal, committed, amt) => {
          const r = decideWithdrawal({ ...ok, balanceMinor: bal, committedMinor: committed, amountMinor: amt });
          if (r.kind === "pay_out") expect(r.amountMinor <= bal - committed).toBe(true);
        },
      ),
    );
  });
});
