/** INV-12 extended: the books agree with orders, charges, funding, the partner and the chain. */
import { describe, expect, it } from "vitest";
import { checkBooks, type OrderFacts } from "../src/index.js";

const paid: OrderFacts = { id: "o1", state: "settled", amountMinor: 1_995_000n, feeMinor: 10_000n, vendLedgerMinor: -1_995_000n, feeLedgerMinor: -10_000n, partner: "delivered" };

describe("checkBooks", () => {
  it("clean books pass", () => {
    expect(checkBooks([paid, { id: "o2", state: "failed", amountMinor: 1n, feeMinor: 0n, vendLedgerMinor: 0n, feeLedgerMinor: 0n }], [{ eventId: "e", credited: true, amountMinor: 5n, ledgerMinor: 5n }])).toEqual({ ok: true, mismatches: [] });
  });
  it("a paid order missing its entries, or charged twice", () => {
    expect(checkBooks([{ ...paid, vendLedgerMinor: 0n }], []).mismatches[0]?.kind).toBe("paid_without_ledger");
    expect(checkBooks([{ ...paid, vendLedgerMinor: -3_990_000n }], []).mismatches[0]?.kind).toBe("paid_without_ledger");
  });
  it("money taken for an order that wasn't paid", () => {
    expect(checkBooks([{ ...paid, state: "failed" }], []).mismatches[0]).toMatchObject({ kind: "ledger_without_payment", state: "failed" });
  });
  it("the partner says it never delivered or reversed", () => {
    for (const partner of ["failed", "reversed", "not_found"] as const) {
      expect(checkBooks([{ ...paid, partner }], []).mismatches[0]).toMatchObject({ kind: "partner_disagrees", partner });
    }
    expect(checkBooks([{ ...paid, partner: "pending" }], []).ok).toBe(true);
  });
  it("dollar charges: credited exactly when confirmed; reverted on chain is a mismatch", () => {
    const charge = { status: "confirmed" as const, nairaMinor: 2_005_000n, fundLedgerMinor: 2_005_000n, chain: "confirmed" as const };
    expect(checkBooks([{ ...paid, charge }], []).ok).toBe(true);
    expect(checkBooks([{ ...paid, charge: { ...charge, fundLedgerMinor: 0n } }], []).mismatches[0]?.kind).toBe("charge_ledger");
    expect(checkBooks([{ ...paid, charge: { ...charge, status: "failed" } }], []).mismatches[0]?.kind).toBe("charge_ledger");
    expect(checkBooks([{ ...paid, charge: { ...charge, chain: "reverted" } }], []).mismatches[0]?.kind).toBe("charge_chain");
  });
  it("funding credited once, rejected funding never credited", () => {
    expect(checkBooks([], [{ eventId: "e", credited: true, amountMinor: 5n, ledgerMinor: 10n }]).mismatches[0]?.kind).toBe("funding_ledger");
    expect(checkBooks([], [{ eventId: "e", credited: false, amountMinor: 5n, ledgerMinor: 5n }]).mismatches[0]?.kind).toBe("funding_ledger");
  });
});
