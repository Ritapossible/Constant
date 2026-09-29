/**
 * Alert-mode invariants 16-18. An alert site never buys.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideAlert, decideSchedule, parseUnits, routeInbound, type AlertDecisionInput } from "../src/index.js";
import { MON_0700, dueSite, hoursAfter, lowRequest } from "./fixtures.js";

const alertSite = (over: Partial<AlertDecisionInput> = {}): AlertDecisionInput => ({
  mode: "alert",
  rawText: "18",
  thresholdUnits: 20,
  lastAlertAt: null,
  now: MON_0700,
  ...over,
});

describe("INV-16 an alert site never produces a buy", () => {
  it("decideSchedule refuses alert mode for every trigger and any input", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.bigInt({ min: 0n, max: 10n ** 12n }), (low, balance) => {
        const base = low ? lowRequest({ mode: "alert" }) : dueSite({ mode: "alert" });
        expect(decideSchedule({ ...base, balanceMinor: balance }).kind).toBe("do_not_buy");
      }),
    );
  });

  it("decideAlert's result type has no amount", () => {
    const d = decideAlert(alertSite());
    expect(d).toEqual({ kind: "alert", units: 18 });
    expect(d).not.toHaveProperty("amountMinor");
  });
});

describe("INV-17 no reading, no alert; above threshold, no alert", () => {
  it("at the threshold alerts", () => {
    expect(decideAlert(alertSite({ rawText: "20" })).kind).toBe("alert");
  });
  it("above the threshold only acks", () => {
    expect(decideAlert(alertSite({ rawText: "21" }))).toEqual({ kind: "ignore", reason: "not_low", units: 21 });
  });
  it("text that is not a reading does not alert", () => {
    expect(decideAlert(alertSite({ rawText: "light don go" }))).toEqual({ kind: "ignore", reason: "not_a_number" });
  });
  it("one owner alert per site per 6 hours", () => {
    expect(decideAlert(alertSite({ lastAlertAt: hoursAfter(MON_0700, -5) })).kind).toBe("ignore");
    expect(decideAlert(alertSite({ lastAlertAt: hoursAfter(MON_0700, -6) })).kind).toBe("alert");
  });
  it("a schedule site never alerts", () => {
    expect(decideAlert(alertSite({ mode: "schedule" }))).toEqual({ kind: "ignore", reason: "not_alert" });
  });
});

describe("INV-18 LOW on an alert site does not buy", () => {
  it("is answered, not routed to a buy", () => {
    expect(routeInbound({ isOwner: true, isSitePhone: false }, "LOW", "alert")).toEqual({
      kind: "reply",
      reply: "alert_site_cannot_buy",
    });
    expect(routeInbound({ isOwner: false, isSitePhone: true }, "low", "alert")).toEqual({
      kind: "reply",
      reply: "alert_site_cannot_buy",
    });
  });
});

describe("parseUnits", () => {
  it.each([
    ["18", 18],
    [" 18 ", 18],
    ["18 units", 18],
    ["18 UNITS", 18],
    ["18unit", 18],
    ["18.5", 18],
    ["18,9", 18],
    ["18 kWh", 18],
    ["0", 0],
  ])("accepts %j as %i", (raw, units) => {
    expect(parseUnits(raw)).toEqual({ ok: true, units });
  });

  it.each([
    "",
    "eighteen",
    "18 20",
    "18 and 20",
    "-5",
    "08012345678", // phone number
    "45012345678", // 11-digit meter
    "4501234567890", // 13-digit meter
    "1234 5678 9012 3456 7890", // a token
    "12345678901234567890",
    "1234567", // implausibly large reading
  ])("rejects %j", (raw) => {
    expect(parseUnits(raw)).toEqual({ ok: false });
  });
});
