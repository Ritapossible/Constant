import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDER_POLICY, dailyRates, decideRunningLow, localParts } from "../src/index.js";

const TZ = "Africa/Lagos";
const DAY = 86_400_000;
// Lagos local time → instant.
const at = (iso: string) => new Date(`${iso}+01:00`);
/** Readings once a day, ending at `end`, falling `perDay` a day from `start`. */
const daily = (end: Date, days: number, start: number, perDay: number) =>
  Array.from({ length: days }, (_, k) => ({ at: new Date(end.getTime() - (days - 1 - k) * DAY), value: start - perDay * k }));

describe("running low, sent to the person (D-092)", () => {
  const noon = at("2026-11-10T12:00:00");

  it("reminds when what's left won't last two days at the person's usual pace", () => {
    // 1,000 MB a day; 1,200 MB left this morning: gone by tomorrow evening.
    const r = decideRunningLow({ readings: daily(at("2026-11-10T08:00:00"), 5, 5_200, 1_000), threshold: 0, lastRemindedAt: null, now: noon, timeZone: TZ });
    expect(r.kind).toBe("remind");
    if (r.kind === "remind") {
      expect(r.likely.getTime()).toBeGreaterThan(noon.getTime());
      expect(r.likely.getTime() - noon.getTime()).toBeLessThan(2 * DAY);
    }
  });

  it("counts the person's level as empty: 1,200 MB left with a 1,000 MB level is 200 MB to go", () => {
    const readings = daily(at("2026-11-10T08:00:00"), 5, 9_200, 1_000); // 5,200 MB left, 1,000 a day
    expect(decideRunningLow({ readings, threshold: 0, lastRemindedAt: null, now: noon, timeZone: TZ }).kind).toBe("none");
    expect(decideRunningLow({ readings, threshold: 4_000, lastRemindedAt: null, now: noon, timeZone: TZ }).kind).toBe("remind");
  });

  it("allows for use since the last reading", () => {
    // 3,500 MB left three days ago at 1,000 a day: about 500 MB now.
    const readings = daily(at("2026-11-07T12:00:00"), 5, 7_500, 1_000);
    expect(decideRunningLow({ readings, threshold: 0, lastRemindedAt: null, now: noon, timeZone: TZ }).kind).toBe("remind");
  });

  it("says nothing without enough readings, with a stale one, at night, or within a day of the last reminder", () => {
    const low = daily(at("2026-11-10T08:00:00"), 5, 5_200, 1_000);
    expect(decideRunningLow({ readings: [], threshold: 0, lastRemindedAt: null, now: noon, timeZone: TZ })).toEqual({ kind: "none", reason: "no_reading" });
    expect(decideRunningLow({ readings: low.slice(-2), threshold: 0, lastRemindedAt: null, now: noon, timeZone: TZ })).toEqual({ kind: "none", reason: "learning" });
    expect(decideRunningLow({ readings: daily(at("2026-11-01T08:00:00"), 5, 5_200, 1_000), threshold: 0, lastRemindedAt: null, now: noon, timeZone: TZ })).toEqual({ kind: "none", reason: "stale" });
    expect(decideRunningLow({ readings: low, threshold: 0, lastRemindedAt: null, now: at("2026-11-10T23:00:00"), timeZone: TZ })).toEqual({ kind: "none", reason: "quiet_hours" });
    expect(decideRunningLow({ readings: low, threshold: 0, lastRemindedAt: at("2026-11-10T07:30:00"), now: noon, timeZone: TZ })).toEqual({ kind: "none", reason: "cooldown" });
  });

  it("is the same daily-use maths the app shows", () => {
    expect(dailyRates([{ at: "2026-11-01T08:00:00Z", value: 900 }, { at: "2026-11-02T08:00:00Z", value: 400 }, { at: "2026-11-03T08:00:00Z", value: 1_500 }, { at: "2026-11-04T08:00:00Z", value: 1_200 }])).toEqual([500, 300]);
  });

  it("property: never at night, never twice within a day, always about a future run-out within the window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 * 24 * 60 }),
        fc.integer({ min: 3, max: 8 }),
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 1, max: 3_000 }),
        fc.option(fc.integer({ min: 0, max: 48 * 60 }), { nil: null }),
        (nowMin, days, start, perDay, sinceLastMin) => {
          const now = new Date(at("2026-11-01T00:00:00").getTime() + nowMin * 60_000);
          const readings = daily(new Date(now.getTime() - 3_600_000), days, start + perDay * days, perDay);
          const lastRemindedAt = sinceLastMin === null ? null : new Date(now.getTime() - sinceLastMin * 60_000);
          const r = decideRunningLow({ readings, threshold: 0, lastRemindedAt, now, timeZone: TZ });
          if (r.kind !== "remind") return;
          const m = localParts(now, TZ).hour * 60 + localParts(now, TZ).minute;
          expect(m >= DEFAULT_REMINDER_POLICY.quietEndMinuteLocal && m < DEFAULT_REMINDER_POLICY.quietStartMinuteLocal).toBe(true);
          if (lastRemindedAt) expect(now.getTime() - lastRemindedAt.getTime()).toBeGreaterThanOrEqual(DEFAULT_REMINDER_POLICY.cooldownHours * 3_600_000);
          expect(r.probability).toBeGreaterThanOrEqual(DEFAULT_REMINDER_POLICY.probabilityAtLeast);
          expect(r.likely.getTime()).toBeGreaterThanOrEqual(now.getTime());
        },
      ),
      { numRuns: 3000 },
    );
  });
});
