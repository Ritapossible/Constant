/**
 * checkBooks: does the ledger agree with every order, charge and funding event, and do the partner and the
 * chain agree with what we think we paid? Pure; the reconciliation job gathers the facts. Any mismatch
 * stops payments for everyone until a person clears it (INV-12).
 */
import type { Minor } from "./types.js";

export type PaidState = "token_stored" | "notifying" | "settled";
const PAID = new Set(["token_stored", "notifying", "settled"]);

export interface OrderFacts {
  id: string;
  state: string;
  amountMinor: Minor;
  feeMinor: Minor;
  /** Sum of this order's `vend` ledger entries (negative) and `fee` entries (negative or zero). */
  vendLedgerMinor: Minor;
  feeLedgerMinor: Minor;
  /** What the partner says now, if asked this run. */
  partner?: "delivered" | "pending" | "failed" | "reversed" | "not_found" | "unknown";
  charge?: {
    status: "pending" | "submitted" | "confirmed" | "failed";
    nairaMinor: Minor;
    /** Sum of the `fund` entry written for this charge. */
    fundLedgerMinor: Minor;
    /** What Base says now, if asked this run. */
    chain?: "confirmed" | "reverted" | "pending" | "unknown";
  };
}

export interface FundingFacts {
  eventId: string;
  credited: boolean;
  amountMinor: Minor;
  ledgerMinor: Minor;
}

export type BookMismatch =
  | { kind: "paid_without_ledger"; orderId: string; expectedMinor: Minor; ledgerMinor: Minor }
  | { kind: "ledger_without_payment"; orderId: string; state: string; ledgerMinor: Minor }
  | { kind: "partner_disagrees"; orderId: string; partner: string }
  | { kind: "charge_ledger"; orderId: string; status: string; expectedMinor: Minor; ledgerMinor: Minor }
  | { kind: "charge_chain"; orderId: string; chain: string }
  | { kind: "funding_ledger"; eventId: string; expectedMinor: Minor; ledgerMinor: Minor };

export function checkBooks(orders: readonly OrderFacts[], funding: readonly FundingFacts[]): { ok: boolean; mismatches: BookMismatch[] } {
  const m: BookMismatch[] = [];
  for (const o of orders) {
    const ledger = o.vendLedgerMinor + o.feeLedgerMinor;
    if (PAID.has(o.state)) {
      if (o.vendLedgerMinor !== -o.amountMinor || o.feeLedgerMinor !== -o.feeMinor) {
        m.push({ kind: "paid_without_ledger", orderId: o.id, expectedMinor: -(o.amountMinor + o.feeMinor), ledgerMinor: ledger });
      }
      if (o.partner === "failed" || o.partner === "reversed" || o.partner === "not_found") m.push({ kind: "partner_disagrees", orderId: o.id, partner: o.partner });
    } else if (ledger !== 0n) {
      // needs_human and failed orders may not carry vend entries until a person settles them.
      m.push({ kind: "ledger_without_payment", orderId: o.id, state: o.state, ledgerMinor: ledger });
    }
    if (o.charge) {
      const c = o.charge;
      const expected = c.status === "confirmed" ? c.nairaMinor : 0n;
      if (c.fundLedgerMinor !== expected) m.push({ kind: "charge_ledger", orderId: o.id, status: c.status, expectedMinor: expected, ledgerMinor: c.fundLedgerMinor });
      if (c.status === "confirmed" && c.chain === "reverted") m.push({ kind: "charge_chain", orderId: o.id, chain: c.chain });
    }
  }
  for (const f of funding) {
    const expected = f.credited ? f.amountMinor : 0n;
    if (f.ledgerMinor !== expected) m.push({ kind: "funding_ledger", eventId: f.eventId, expectedMinor: expected, ledgerMinor: f.ledgerMinor });
  }
  return { ok: m.length === 0, mismatches: m };
}
