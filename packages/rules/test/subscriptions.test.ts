import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_REMINDER, localParts, nextRenewalDate, subscriptionReminder } from "../src/index.js";

const TZ = "Africa/Lagos";
// Lagos local time → instant.
const at = (iso: string) => new Date(`${iso}+01:00`);

describe("INV-119 subscription renewal reminders (D-096)", () => {
  it("says 'soon' three and two days ahead, 'tomorrow' the day before, nothing on the day", () => {
    const r = (iso: string) => subscriptionReminder({ renewDay: 9, now: at(iso), timeZone: TZ });
    expect(r("2026-11-05T12:00:00")).toBeNull(); // four days out
    expect(r("2026-11-06T12:00:00")).toEqual({ stage: "soon", renewsAt: at("2026-11-09T07:00:00") });
    expect(r("2026-11-07T12:00:00")?.stage).toBe("soon");
    expect(r("2026-11-08T12:00:00")).toEqual({ stage: "tomorrow", renewsAt: at("2026-11-09T07:00:00") });
    expect(r("2026-11-09T12:00:00")).toBeNull(); // the day itself: it may already be charged
  });

  it("only between 9 am and 8 pm in the person's time zone", () => {
    expect(subscriptionReminder({ renewDay: 9, now: at("2026-11-08T08:59:00"), timeZone: TZ })).toBeNull();
    expect(subscriptionReminder({ renewDay: 9, now: at("2026-11-08T09:00:00"), timeZone: TZ })?.stage).toBe("tomorrow");
    expect(subscriptionReminder({ renewDay: 9, now: at("2026-11-08T19:59:00"), timeZone: TZ })?.stage).toBe("tomorrow");
    expect(subscriptionReminder({ renewDay: 9, now: at("2026-11-08T20:00:00"), timeZone: TZ })).toBeNull();
  });

  it("crosses months and years", () => {
    expect(nextRenewalDate(3, at("2026-12-29T12:00:00"), TZ)).toEqual({ year: 2027, month: 1, day: 3 });
    expect(subscriptionReminder({ renewDay: 1, now: at("2026-12-31T12:00:00"), timeZone: TZ })).toEqual({ stage: "tomorrow", renewsAt: at("2027-01-01T07:00:00") });
    expect(subscriptionReminder({ renewDay: 2, now: at("2026-11-29T12:00:00"), timeZone: TZ })?.stage).toBe("soon");
  });

  it("needs a renewal day", () => {
    expect(subscriptionReminder({ renewDay: null, now: at("2026-11-08T12:00:00"), timeZone: TZ })).toBeNull();
  });

  it("property: in waking hours, about a renewal one to three days ahead, the same renewal all day", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 * 24 * 60 }), fc.integer({ min: 1, max: 28 }), (minutes, renewDay) => {
        const now = new Date(at("2026-01-01T00:00:00").getTime() + minutes * 60_000);
        const r = subscriptionReminder({ renewDay, now, timeZone: TZ });
        if (!r) return;
        const { hour } = localParts(now, TZ);
        expect(hour >= SUBSCRIPTION_REMINDER.fromHour && hour < SUBSCRIPTION_REMINDER.untilHour).toBe(true);
        const days = (r.renewsAt.getTime() - now.getTime()) / 86_400_000;
        expect(days).toBeGreaterThan(0);
        expect(days).toBeLessThan(SUBSCRIPTION_REMINDER.soonDays + 1);
        expect(localParts(r.renewsAt, TZ).day).toBe(renewDay);
        expect(r.stage === "tomorrow").toBe(days < 1);
        // Later the same day, the same renewal and stage: one key, one message.
        const later = subscriptionReminder({ renewDay, now: new Date(Math.min(now.getTime() + 3_600_000, r.renewsAt.getTime())), timeZone: TZ });
        if (later) expect(later.renewsAt.getTime()).toBe(r.renewsAt.getTime());
      }),
      { numRuns: 3000 },
    );
  });
});
