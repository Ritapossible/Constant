import { describe, expect, it } from "vitest";
import { checkQuote, decideFundingCredit, decideReversal, reconcile } from "../src/index.js";
import { naira } from "./fixtures.js";

describe("funding credit", () => {
  const ok = { signatureValid: true, isNewEvent: true, amountMinor: naira(50_000), matchedSiteIds: ["s1"] };

  it("credits exactly one site", () => {
    expect(decideFundingCredit(ok)).toEqual({ kind: "credit", siteId: "s1", amountMinor: naira(50_000) });
  });
  it.each([
    ["bad signature", { signatureValid: false }, "bad_signature"],
    ["replayed event", { isNewEvent: false }, "duplicate"],
    ["zero amount", { amountMinor: 0n }, "non_positive"],
    ["negative amount", { amountMinor: -1n }, "non_positive"],
    ["unknown account", { matchedSiteIds: [] }, "no_site"],
    ["account on two sites", { matchedSiteIds: ["s1", "s2"] }, "ambiguous_site"],
  ])("rejects %s", (_name, over, reason) => {
    expect(decideFundingCredit({ ...ok, ...over })).toEqual({ kind: "reject", reason });
  });
});

describe("reversal", () => {
  it("debits and freezes when the balance would go negative", () => {
    expect(decideReversal(naira(10_000), naira(50_000))).toEqual({ debitMinor: -naira(50_000), freeze: true });
    expect(decideReversal(naira(50_000), naira(50_000))).toEqual({ debitMinor: -naira(50_000), freeze: false });
  });
});

describe("price check", () => {
  it("more than double the last price is an exception", () => {
    expect(checkQuote(201n, 100n).kind).toBe("price_exception");
    expect(checkQuote(200n, 100n).kind).toBe("ok");
    expect(checkQuote(10_000n, null).kind).toBe("ok");
  });
});

describe("INV-12 reconciliation", () => {
  it("clean books keep vending on", () => {
    const r = reconcile(
      [{ siteId: "s1", ledgerSumMinor: naira(35_000), cachedBalanceMinor: naira(35_000) }],
      [{ orderId: "o1", amountMinor: naira(15_000), partnerRef: "p1" }],
      [{ partnerRef: "p1", amountMinor: naira(15_000) }],
    );
    expect(r).toEqual({ mismatches: [], vendingEnabled: true });
  });

  it("any single mismatch turns vending off for everyone", () => {
    const cases = [
      reconcile([{ siteId: "s1", ledgerSumMinor: 1n, cachedBalanceMinor: 2n }], [], []),
      reconcile([], [{ orderId: "o1", amountMinor: 1n, partnerRef: "p1" }], []),
      reconcile([], [], [{ partnerRef: "p9", amountMinor: 1n }]),
      reconcile([], [{ orderId: "o1", amountMinor: 1n, partnerRef: "p1" }], [{ partnerRef: "p1", amountMinor: 2n }]),
    ];
    for (const r of cases) {
      expect(r.vendingEnabled).toBe(false);
      expect(r.mismatches).toHaveLength(1);
    }
  });
});

describe("payout accounts (D-067)", () => {
  it("names must match the account holder, in any order, ignoring extra names and prefixes", async () => {
    const { namesMatch } = await import("../src/index.js");
    expect(namesMatch("CONSTANT/ADA OBI", "OBI ADAEZE ADA")).toBe(true);
    expect(namesMatch("Ada Obi", "OBI, ADA CHIOMA")).toBe(true);
    expect(namesMatch("Ada Obi", "ADA OKAFOR")).toBe(false);
    expect(namesMatch("Ada", "ADA OBI")).toBe(false);
  });
  it("a new payout account waits 24 hours", async () => {
    const { payoutAccountUsable } = await import("../src/index.js");
    const t = new Date("2026-11-14T06:00:00Z");
    expect(payoutAccountUsable(t, new Date(t.getTime() + 23 * 3_600_000))).toBe(false);
    expect(payoutAccountUsable(t, new Date(t.getTime() + 24 * 3_600_000))).toBe(true);
  });
});
