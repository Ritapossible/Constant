/**
 * Order state machine: INV-7, 8, 11, 13.
 */
import { describe, expect, it } from "vitest";
import {
  IllegalTransition,
  isOpen,
  lowOrderKey,
  nextOrderState,
  recoverVending,
  scheduleOrderKey,
  writesVendLedgerEntry,
  type OrderEvent,
  type OrderState,
} from "../src/index.js";
import { MON_0700 } from "./fixtures.js";

const run = (events: OrderEvent[], from: OrderState = "ready") => events.reduce(nextOrderState, from);

describe("happy path", () => {
  it("ready → vending → token_stored → notifying → settled", () => {
    expect(
      run([{ type: "start" }, { type: "accepted", partnerRef: "p1" }, { type: "token" }, { type: "notify_start" }, { type: "notified" }]),
    ).toBe("settled");
  });
});

describe("INV-13 HTTP 200 is not settlement", () => {
  it("acceptance keeps the order in vending", () => {
    expect(run([{ type: "start" }, { type: "accepted", partnerRef: "p1" }])).toBe("vending");
  });
  it("vending cannot jump to settled or notifying", () => {
    expect(() => nextOrderState("vending", { type: "notified" })).toThrow(IllegalTransition);
    expect(() => nextOrderState("vending", { type: "notify_start" })).toThrow(IllegalTransition);
  });
});

describe("INV-11 token stored before SMS; SMS failure resends, never rebuys", () => {
  it("cannot notify before the token is stored", () => {
    expect(() => nextOrderState("ready", { type: "notify_start" })).toThrow(IllegalTransition);
  });
  it("SMS failure stays in notifying", () => {
    expect(nextOrderState("notifying", { type: "notify_failed" })).toBe("notifying");
  });
  it("no path from notifying or token_stored back to vending", () => {
    for (const s of ["token_stored", "notifying", "settled"] as const) {
      expect(() => nextOrderState(s, { type: "start" })).toThrow(IllegalTransition);
    }
  });
});

describe("INV-8 a crash mid-vend never vends twice", () => {
  it("with a saved partnerRef: fetch, do not vend", () => {
    expect(recoverVending("p1")).toEqual({ kind: "fetch", partnerRef: "p1" });
  });
  it("without one: needs a human and the site is frozen", () => {
    expect(recoverVending(null)).toEqual({ kind: "needs_human_and_freeze_site" });
    expect(nextOrderState("vending", { type: "ambiguous" })).toBe("needs_human");
  });
  it("needs_human still holds the open-order slot, so nothing else buys", () => {
    expect(isOpen("needs_human")).toBe(true);
    expect(isOpen("settled")).toBe(false);
    expect(isOpen("failed")).toBe(false);
  });
  it("terminal states accept nothing", () => {
    for (const s of ["settled", "failed"] as const) {
      for (const t of ["start", "token", "rejected", "ambiguous", "notified"] as const) {
        expect(() => nextOrderState(s, { type: t } as OrderEvent)).toThrow(IllegalTransition);
      }
    }
  });
});

describe("ledger timing", () => {
  it("the vend entry is written at acceptance and nowhere else", () => {
    expect(writesVendLedgerEntry({ type: "accepted", partnerRef: "p" })).toBe(true);
    for (const t of ["start", "token", "notified", "notify_start"] as const) {
      expect(writesVendLedgerEntry({ type: t })).toBe(false);
    }
  });
});

describe("INV-7 idempotency keys", () => {
  it("the same slot always yields the same key", () => {
    expect(scheduleOrderKey("s1", MON_0700)).toBe(scheduleOrderKey("s1", new Date(MON_0700.getTime())));
  });
  it("the same inbound message always yields the same LOW key", () => {
    expect(lowOrderKey("s1", "wamid.X")).toBe(lowOrderKey("s1", "wamid.X"));
    expect(lowOrderKey("s1", "wamid.X")).not.toBe(lowOrderKey("s2", "wamid.X"));
  });
});
