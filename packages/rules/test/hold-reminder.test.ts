import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HOLD_REMINDER, holdReminder, localParts } from "../src/index.js";

const TZ = "Africa/Lagos"; // UTC+1, no daylight saving
const H = 3_600_000;
// Lagos local time → instant.
const at = (iso: string) => new Date(`${iso}+01:00`);

describe("reminders while a bill waits (D-091)", () => {
  const due = at("2026-11-12T18:00:00"); // the TV goes off at 6 pm

  it("nothing while the end is more than a day away", () => {
    expect(holdReminder({ now: at("2026-11-11T12:00:00"), dueAt: due, lastNotifiedAt: null, timeZone: TZ })).toBeNull();
  });

  it("a day out: due soon; in the last 6 hours: the last call", () => {
    expect(holdReminder({ now: at("2026-11-11T19:00:00"), dueAt: due, lastNotifiedAt: at("2026-11-11T09:00:00"), timeZone: TZ })).toBe("due_soon");
    expect(holdReminder({ now: at("2026-11-12T12:30:00"), dueAt: due, lastNotifiedAt: at("2026-11-11T19:00:00"), timeZone: TZ })).toBe("last_call");
  });

  it("never at night, even in the last hours", () => {
    const early = at("2026-11-13T06:00:00");
    expect(holdReminder({ now: at("2026-11-13T02:00:00"), dueAt: early, lastNotifiedAt: null, timeZone: TZ })).toBeNull();
    expect(holdReminder({ now: at("2026-11-12T22:30:00"), dueAt: early, lastNotifiedAt: null, timeZone: TZ })).toBeNull();
  });

  it("an early-morning end gets its last call the evening before", () => {
    const early = at("2026-11-13T06:00:00");
    expect(holdReminder({ now: at("2026-11-12T20:15:00"), dueAt: early, lastNotifiedAt: at("2026-11-12T10:00:00"), timeZone: TZ })).toBe("last_call");
    expect(holdReminder({ now: at("2026-11-12T19:45:00"), dueAt: early, lastNotifiedAt: at("2026-11-12T10:00:00"), timeZone: TZ })).toBe("due_soon");
  });

  it("spaced from the previous message: hours for a reminder, an hour for the last call", () => {
    expect(holdReminder({ now: at("2026-11-11T19:00:00"), dueAt: due, lastNotifiedAt: at("2026-11-11T17:30:00"), timeZone: TZ })).toBeNull();
    expect(holdReminder({ now: at("2026-11-12T13:00:00"), dueAt: due, lastNotifiedAt: at("2026-11-12T12:30:00"), timeZone: TZ })).toBeNull();
    expect(holdReminder({ now: at("2026-11-12T13:40:00"), dueAt: due, lastNotifiedAt: at("2026-11-12T12:30:00"), timeZone: TZ })).toBe("last_call");
  });

  it("nothing once the end has passed, or when the end isn't known", () => {
    expect(holdReminder({ now: at("2026-11-12T18:30:00"), dueAt: due, lastNotifiedAt: null, timeZone: TZ })).toBeNull();
    expect(holdReminder({ now: at("2026-11-12T12:00:00"), dueAt: null, lastNotifiedAt: null, timeZone: TZ })).toBeNull();
  });

  it("property: a reminder is only ever sent in waking hours, before the end, within a day of it, and spaced", () => {
    const base = at("2026-11-01T00:00:00").getTime();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 * 24 * 60 }), fc.integer({ min: 0, max: 3 * 24 * 60 }), fc.option(fc.integer({ min: 0, max: 48 * 60 }), { nil: null }), (nowMin, leftMin, gapMin) => {
        const now = new Date(base + nowMin * 60_000);
        const dueAt = new Date(now.getTime() + leftMin * 60_000);
        const lastNotifiedAt = gapMin === null ? null : new Date(now.getTime() - gapMin * 60_000);
        const r = holdReminder({ now, dueAt, lastNotifiedAt, timeZone: TZ });
        if (r === null) return;
        const { hour } = localParts(now, TZ);
        expect(hour >= HOLD_REMINDER.quietUntilHour && hour < HOLD_REMINDER.quietFromHour).toBe(true);
        expect(dueAt.getTime()).toBeGreaterThan(now.getTime());
        expect(dueAt.getTime() - now.getTime()).toBeLessThanOrEqual(HOLD_REMINDER.dueSoonHours * H);
        if (lastNotifiedAt) expect(now.getTime() - lastNotifiedAt.getTime()).toBeGreaterThanOrEqual(HOLD_REMINDER.lastCallMinGapHours * H);
      }),
      { numRuns: 4000 },
    );
  });

  it("property: every bill with a known end, held a day or more ahead, gets a last call before it lapses", () => {
    // Walk a held bill through the hourly rechecks the worker does; whatever the end time, a last call happens.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 7 * 24 * 60 }), (endMin) => {
        const dueAt = new Date(at("2026-11-02T00:00:00").getTime() + endMin * 60_000);
        let now = new Date(dueAt.getTime() - 30 * H);
        let last: Date | null = now;
        let sawLastCall = false;
        while (now < dueAt) {
          const r = holdReminder({ now, dueAt, lastNotifiedAt: last, timeZone: TZ });
          if (r) last = now;
          if (r === "last_call") sawLastCall = true;
          now = new Date(now.getTime() + H);
        }
        expect(sawLastCall).toBe(true);
      }),
      { numRuns: 1500 },
    );
  });
});
