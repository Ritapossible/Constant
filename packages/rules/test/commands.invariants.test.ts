/**
 * INV-10: the site phone cannot change anything; it may only ask for LOW or SKIP.
 */
import { describe, expect, it } from "vitest";
import { parseCommand, routeInbound } from "../src/index.js";

const owner = { isOwner: true, isSitePhone: false };
const site = { isOwner: false, isSitePhone: true };
const stranger = { isOwner: false, isSitePhone: false };

describe("parseCommand", () => {
  it.each([
    ["STOP", { word: "STOP" }],
    ["stop", { word: "STOP" }],
    ["  Stop.  ", { word: "STOP" }],
    ["Balance!", { word: "BALANCE" }],
    ["STOP 6781", { word: "STOP", meterLast4: "6781" }],
    ["low   6781", { word: "LOW", meterLast4: "6781" }],
  ])("%j", (raw, expected) => {
    expect(parseCommand(raw)).toEqual(expected);
  });

  it.each(["STOPP", "please stop", "STOP now", "STOP 678", "BALANCE 6781", "SKIP 6781 6782", "stop it!"])(
    "rejects %j",
    (raw) => {
      expect(parseCommand(raw)).toBeNull();
    },
  );
});

describe("INV-10 site phone permissions", () => {
  it.each(["LOW", "SKIP"])("site phone may send %s", (w) => {
    expect(routeInbound(site, w, "schedule").kind).toBe("command");
  });

  it.each(["STOP", "START", "BALANCE", "STOP 6781"])("site phone may not send %s", (w) => {
    expect(routeInbound(site, w, "schedule")).toEqual({ kind: "reply", reply: "owner_only" });
  });

  it("owner may send everything", () => {
    for (const w of ["LOW", "SKIP", "STOP", "START", "BALANCE"]) {
      expect(routeInbound(owner, w, "schedule").kind).toBe("command");
    }
  });

  it("an owner who is also the site phone keeps owner rights", () => {
    expect(routeInbound({ isOwner: true, isSitePhone: true }, "STOP", "schedule").kind).toBe("command");
  });

  it("there is no command that carries a meter number, amount, day or phone", () => {
    // Anything that is not an exact command is help text, never an edit.
    for (const t of ["METER 45012345678", "AMOUNT 20000", "DAYS MON", "OWNER 08012345678"]) {
      expect(routeInbound(site, t, "schedule")).toEqual({ kind: "reply", reply: "help" });
      expect(routeInbound(owner, t, "schedule")).toEqual({ kind: "reply", reply: "help" });
    }
  });
});

describe("routing", () => {
  it("strangers get the one-line explanation", () => {
    expect(routeInbound(stranger, "LOW", "schedule")).toEqual({ kind: "reply", reply: "not_a_customer" });
  });

  it("a number on a schedule site is explained, not parsed", () => {
    expect(routeInbound(site, "18", "schedule")).toEqual({ kind: "reply", reply: "schedule_site_number" });
  });

  it("a number from the site phone on an alert site is a reading", () => {
    expect(routeInbound(site, "18", "alert")).toEqual({ kind: "unit_reading", text: "18" });
  });
});
