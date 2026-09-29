/**
 * Funding, reversals, the price check and reconciliation. Pure, integer minor units.
 */
import type { Minor } from "./types.js";

// ── Funding ────────────────────────────────────────────────────────────────

export interface FundingEventInput {
  signatureValid: boolean;
  /** False if provider_event_id is already in funding_events. */
  isNewEvent: boolean;
  amountMinor: Minor;
  /** Sites whose funding account matched the event. Must be exactly one. */
  matchedSiteIds: readonly string[];
}

export type FundingDecision =
  | { kind: "credit"; siteId: string; amountMinor: Minor }
  | { kind: "reject"; reason: "bad_signature" | "duplicate" | "non_positive" | "no_site" | "ambiguous_site" };

export function decideFundingCredit(i: FundingEventInput): FundingDecision {
  if (!i.signatureValid) return { kind: "reject", reason: "bad_signature" };
  if (!i.isNewEvent) return { kind: "reject", reason: "duplicate" };
  if (i.amountMinor <= 0n) return { kind: "reject", reason: "non_positive" };
  if (i.matchedSiteIds.length === 0) return { kind: "reject", reason: "no_site" };
  const [siteId, ...others] = i.matchedSiteIds;
  if (siteId === undefined || others.length > 0) return { kind: "reject", reason: "ambiguous_site" };
  return { kind: "credit", siteId, amountMinor: i.amountMinor };
}

/** A reversal always debits. It freezes the site if the balance would go negative. */
export function decideReversal(balanceMinor: Minor, reversedMinor: Minor): { debitMinor: Minor; freeze: boolean } {
  if (reversedMinor <= 0n) throw new Error("reversal: amount must be positive");
  return { debitMinor: -reversedMinor, freeze: balanceMinor - reversedMinor < 0n };
}

// ── Price check ────────────────────────────────────────────────────────────

/**
 * Compare a side-effect-free quote against the last successful buy on this
 * meter. More than double the per-unit price: do not auto-buy; tell the owner.
 * Prices are minor units per 1000 kWh-units to keep integer precision.
 * Without a prior price there is nothing to compare, so the run proceeds.
 */
export type QuoteCheck = { kind: "ok" } | { kind: "price_exception"; quotedMilliMinorPerUnit: Minor; lastMilliMinorPerUnit: Minor };

export function checkQuote(quotedMilliMinorPerUnit: Minor, lastMilliMinorPerUnit: Minor | null): QuoteCheck {
  if (lastMilliMinorPerUnit === null || lastMilliMinorPerUnit <= 0n) return { kind: "ok" };
  if (quotedMilliMinorPerUnit > lastMilliMinorPerUnit * 2n) {
    return { kind: "price_exception", quotedMilliMinorPerUnit, lastMilliMinorPerUnit };
  }
  return { kind: "ok" };
}

// ── Reconciliation ─────────────────────────────────────────────────────────

export interface SiteBalanceRow {
  siteId: string;
  ledgerSumMinor: Minor;
  cachedBalanceMinor: Minor | null;
}

export interface OrderRefRow {
  orderId: string;
  /** Our settled amount for this order. */
  amountMinor: Minor;
  partnerRef: string | null;
}

export interface PartnerRefRow {
  partnerRef: string;
  amountMinor: Minor;
}

export type Mismatch =
  | { kind: "balance"; siteId: string; ledgerSumMinor: Minor; cachedBalanceMinor: Minor }
  | { kind: "missing_at_partner"; orderId: string; partnerRef: string | null }
  | { kind: "missing_in_ledger"; partnerRef: string }
  | { kind: "amount"; orderId: string; partnerRef: string; oursMinor: Minor; theirsMinor: Minor };

export interface ReconcileResult {
  mismatches: Mismatch[];
  /** Invariant 12: any mismatch stops vending for everyone until a human clears it. */
  vendingEnabled: boolean;
}

export function reconcile(
  balances: readonly SiteBalanceRow[],
  ourSettled: readonly OrderRefRow[],
  partnerSettled: readonly PartnerRefRow[],
): ReconcileResult {
  const mismatches: Mismatch[] = [];

  for (const b of balances) {
    if (b.cachedBalanceMinor !== null && b.cachedBalanceMinor !== b.ledgerSumMinor) {
      mismatches.push({
        kind: "balance",
        siteId: b.siteId,
        ledgerSumMinor: b.ledgerSumMinor,
        cachedBalanceMinor: b.cachedBalanceMinor,
      });
    }
  }

  const theirs = new Map(partnerSettled.map((p) => [p.partnerRef, p]));
  const seen = new Set<string>();
  for (const o of ourSettled) {
    const p = o.partnerRef ? theirs.get(o.partnerRef) : undefined;
    if (!p || !o.partnerRef) {
      mismatches.push({ kind: "missing_at_partner", orderId: o.orderId, partnerRef: o.partnerRef });
      continue;
    }
    seen.add(o.partnerRef);
    if (p.amountMinor !== o.amountMinor) {
      mismatches.push({
        kind: "amount",
        orderId: o.orderId,
        partnerRef: o.partnerRef,
        oursMinor: o.amountMinor,
        theirsMinor: p.amountMinor,
      });
    }
  }
  for (const p of partnerSettled) {
    if (!seen.has(p.partnerRef)) mismatches.push({ kind: "missing_in_ledger", partnerRef: p.partnerRef });
  }

  return { mismatches, vendingEnabled: mismatches.length === 0 };
}
