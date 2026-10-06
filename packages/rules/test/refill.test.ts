/**
 * Data and light refill decisions (D-045 to D-048; INV-27, INV-30, INV-40 to INV-44).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  decideDataRefill,
  decideSpareToken,
  daysOfLightLeft,
  expectedSupplyHoursPerDay,
  lightForecastMode,
  unitsPerSupplyHour,
  type DataRefillInput,
  type SpareTokenInput,
} from "../src/index.js";

const now = new Date("2026-10-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

const data = (over: Partial<DataRefillInput> = {}): DataRefillInput => ({
  autopilotOn: true,
  simConfirmed: true,
  planAddsToBalance: true,
  lastCalibration: { mainDataMb: 1000, at: hoursAgo(2) },
  usedSinceCalibrationMb: 800,
  thresholdMb: 300,
  maxCalibrationAgeHours: 24,
  buyOnEstimate: false,
  now,
  ...over,
});

describe("INV-40 data: unknown is never low", () => {
  it("no successful USSD reading means no buy and no ask", () => {
    expect(decideDataRefill(data({ lastCalibration: null }))).toEqual({ kind: "none", reason: "no_calibration" });
  });

  it("property: with no calibration, nothing is ever bought whatever the counter says", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.boolean(), (used, optIn) => {
        const d = decideDataRefill(data({ lastCalibration: null, usedSinceCalibrationMb: used, buyOnEstimate: optIn }));
        expect(d.kind).toBe("none");
      }),
    );
  });
});

describe("INV-41 data: never guess the SIM, never buy a plan that might replace", () => {
  it("dual-SIM without a chosen SIM does nothing", () => {
    expect(decideDataRefill(data({ simConfirmed: false }))).toEqual({ kind: "none", reason: "sim_unconfirmed" });
  });
  it("a plan not known to add to the bundle is asked about, not bought", () => {
    expect(decideDataRefill(data({ planAddsToBalance: null })).kind).toBe("ask");
    expect(decideDataRefill(data({ planAddsToBalance: false })).kind).toBe("ask");
  });
});

describe("INV-27 data: measured buys automatically; estimates only if the owner opted in", () => {
  it("fresh network reading at the line: buy, measured", () => {
    expect(decideDataRefill(data())).toEqual({ kind: "buy", basis: "measured", estimateMb: 200 });
  });
  it("above the line: nothing", () => {
    expect(decideDataRefill(data({ usedSinceCalibrationMb: 100 })).kind).toBe("none");
  });
  it("stale network reading: ask by default", () => {
    expect(decideDataRefill(data({ lastCalibration: { mainDataMb: 1000, at: hoursAgo(30) } }))).toEqual({
      kind: "ask",
      reason: "stale_calibration",
      estimateMb: 200,
    });
  });
  it("stale network reading with opt-in: buy, labelled estimated", () => {
    const d = decideDataRefill(data({ lastCalibration: { mainDataMb: 1000, at: hoursAgo(30) }, buyOnEstimate: true }));
    expect(d).toEqual({ kind: "buy", basis: "estimated", estimateMb: 200 });
  });
  it("autopilot off: ask, never buy", () => {
    expect(decideDataRefill(data({ autopilotOn: false })).kind).toBe("ask");
  });
  it("a reading from the future is not treated as fresh", () => {
    const d = decideDataRefill(data({ lastCalibration: { mainDataMb: 1000, at: new Date(now.getTime() + 3_600_000) } }));
    expect(d.kind).toBe("ask");
  });
});

describe("INV-42 light: don't sound more confident than the readings allow", () => {
  it.each([
    [0, 0, "learning"],
    [1, 10, "learning"],
    [2, 3, "rough"],
    [3, 14, "rough"],
    [5, 5, "rough"],
    [4, 7, "probability"],
  ])("%i readings over %i days → %s", (n, span, mode) => {
    expect(lightForecastMode(n, span)).toBe(mode);
  });
});

describe("INV-43 light: usage counts only while the grid is on", () => {
  it("rate per supply hour survives a bad supply week", () => {
    // 60 units used over a week with 8h supply a day = 56 supply hours.
    const rate = unitsPerSupplyHour(60, 56)!;
    // Next week band A (20h): runs out much faster than a 24h-blind average suggests.
    expect(daysOfLightLeft(60, rate, 20)).toBeCloseTo(2.8, 1);
    expect(daysOfLightLeft(60, rate, 8)).toBeCloseTo(7, 1);
  });
  it("one-tap answers beat the band assumption", () => {
    expect(expectedSupplyHoursPerDay("A", [])).toBe(20);
    expect(expectedSupplyHoursPerDay("A", [{ morning: true, afternoon: false, night: false }])).toBe(8);
    expect(expectedSupplyHoursPerDay(null, [])).toBe(12);
  });
  it("no supply hours or nothing used gives no rate or no date", () => {
    expect(unitsPerSupplyHour(10, 0)).toBeNull();
    expect(daysOfLightLeft(50, 0, 20)).toBeNull();
  });
});

describe("INV-30 / INV-44 the spare token", () => {
  const base: SpareTokenInput = {
    spareEnabled: true,
    outstanding: null,
    earlyRunOutDays: 2,
    now,
    leadDays: 3,
    maxSpareAgeDays: 14,
  };

  it("buys the spare when the cautious run-out is close", () => {
    expect(decideSpareToken(base)).toEqual({ kind: "buy_spare" });
  });
  it("waits while run-out is further away or unknown", () => {
    expect(decideSpareToken({ ...base, earlyRunOutDays: 6 })).toEqual({ kind: "none", reason: "not_yet" });
    expect(decideSpareToken({ ...base, earlyRunOutDays: null })).toEqual({ kind: "none", reason: "unknown_runout" });
  });
  it("never buys a second spare while one is waiting", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 30, noNaN: true }), fc.double({ min: 0, max: 13, noNaN: true }), (early, age) => {
        const d = decideSpareToken({ ...base, earlyRunOutDays: early, outstanding: { boughtAt: new Date(now.getTime() - age * 86_400_000) } });
        expect(d.kind).not.toBe("buy_spare");
      }),
    );
  });
  it("an old spare gets a key-it-in reminder", () => {
    const d = decideSpareToken({ ...base, outstanding: { boughtAt: new Date(now.getTime() - 15 * 86_400_000) } });
    expect(d.kind).toBe("remind_to_key");
  });
  it("disabled does nothing", () => {
    expect(decideSpareToken({ ...base, spareEnabled: false })).toEqual({ kind: "none", reason: "disabled" });
  });
});
