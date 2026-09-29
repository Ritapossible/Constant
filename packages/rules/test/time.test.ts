import { describe, expect, it } from "vitest";
import { nextSlotAfter, weekStart, zonedInstant, type Schedule } from "../src/index.js";

describe("zonedInstant", () => {
  it.each([
    ["Africa/Lagos", "2026-10-05T06:00:00.000Z"],
    ["Africa/Accra", "2026-10-05T07:00:00.000Z"],
    ["Africa/Johannesburg", "2026-10-05T05:00:00.000Z"],
    ["Africa/Nairobi", "2026-10-05T04:00:00.000Z"],
  ])("07:00 on 2026-10-05 in %s", (tz, iso) => {
    expect(zonedInstant({ year: 2026, month: 10, day: 5 }, 420, tz).toISOString()).toBe(iso);
  });

  it("is correct across a DST change too (not needed today, but markets change)", () => {
    // London springs forward on 2026-03-29.
    expect(zonedInstant({ year: 2026, month: 3, day: 30 }, 420, "Europe/London").toISOString()).toBe(
      "2026-03-30T06:00:00.000Z",
    );
  });
});

describe("nextSlotAfter", () => {
  const monThu: Schedule = { weekdays: [1, 4], runMinuteLocal: 420, timeZone: "Africa/Lagos" };

  it("Sunday night → Monday 07:00", () => {
    expect(nextSlotAfter(new Date("2026-10-04T20:00:00Z"), monThu).toISOString()).toBe("2026-10-05T06:00:00.000Z");
  });
  it("exactly at the slot → the next one (strictly after)", () => {
    expect(nextSlotAfter(new Date("2026-10-05T06:00:00Z"), monThu).toISOString()).toBe("2026-10-08T06:00:00.000Z");
  });
  it("Thursday after 07:00 → next Monday", () => {
    expect(nextSlotAfter(new Date("2026-10-08T09:00:00Z"), monThu).toISOString()).toBe("2026-10-12T06:00:00.000Z");
  });
  it("a single weekday wraps a full week", () => {
    const mon: Schedule = { ...monThu, weekdays: [1] };
    expect(nextSlotAfter(new Date("2026-10-05T06:00:01Z"), mon).toISOString()).toBe("2026-10-12T06:00:00.000Z");
  });
  it("rejects an empty schedule", () => {
    expect(() => nextSlotAfter(new Date(), { ...monThu, weekdays: [] })).toThrow();
  });
});

describe("weekStart", () => {
  it("is local Monday 00:00", () => {
    // Sunday 23:30 Lagos is still the week that began on Monday 2026-09-28.
    expect(weekStart(new Date("2026-10-04T22:30:00Z"), "Africa/Lagos").toISOString()).toBe("2026-09-27T23:00:00.000Z");
    // Monday 00:30 Lagos starts a new week.
    expect(weekStart(new Date("2026-10-04T23:30:00Z"), "Africa/Lagos").toISOString()).toBe("2026-10-04T23:00:00.000Z");
  });
});
