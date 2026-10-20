/**
 * Pots (D-083): money set aside for one bill. A pot can pay only its own bill; free money (not in any pot) can pay any
 * bill. A bill's payment takes from its pot first and the rest from free money. Pure functions: the worker, the API
 * and the database all decide with these.
 */
import type { Minor } from "./types.js";

/** How a payment of `need` is drawn: from the bill's pot first, the rest from free money. */
export function splitDraw(needMinor: Minor, potMinor: Minor): { fromPot: Minor; fromFree: Minor } {
  if (needMinor < 0n) throw new Error("splitDraw: need must be >= 0");
  const pot = potMinor > 0n ? potMinor : 0n;
  const fromPot = needMinor < pot ? needMinor : pot;
  return { fromPot, fromFree: needMinor - fromPot };
}

/**
 * Free money already spoken for: for each open order not yet written to the ledger, what its own pot can't cover.
 * (One open order per bill, so each pot is counted once.)
 */
export function freeCommitted(openOrders: readonly { needMinor: Minor; potMinor: Minor }[]): Minor {
  return openOrders.reduce((s, o) => s + splitDraw(o.needMinor, o.potMinor).fromFree, 0n);
}

/** What one bill can spend now: its own pot, plus free money nothing else has claimed. Never another bill's pot. */
export function availableForBill(i: { potMinor: Minor; freeMinor: Minor; freeCommittedMinor: Minor }): Minor {
  const free = i.freeMinor - i.freeCommittedMinor;
  return (i.potMinor > 0n ? i.potMinor : 0n) + (free > 0n ? free : 0n);
}

export type PotMoveDecision = { kind: "move"; amountMinor: Minor } | { kind: "refuse"; reason: "non_positive" | "not_enough_free" | "not_enough_in_pot" | "payment_in_progress" | "bill_closed" };

/**
 * Moving money into a bill's pot (from free money) or out of it (back to free money). Never more than is there, and a
 * pot is not emptied while its bill's payment is in progress.
 */
export function decidePotMove(i: {
  direction: "in" | "out";
  amountMinor: Minor;
  freeAvailableMinor: Minor;
  potMinor: Minor;
  billOpen: boolean;
  paymentInProgress: boolean;
}): PotMoveDecision {
  if (i.amountMinor <= 0n) return { kind: "refuse", reason: "non_positive" };
  if (i.direction === "in") {
    if (!i.billOpen) return { kind: "refuse", reason: "bill_closed" };
    if (i.amountMinor > i.freeAvailableMinor) return { kind: "refuse", reason: "not_enough_free" };
    return { kind: "move", amountMinor: i.amountMinor };
  }
  if (i.paymentInProgress) return { kind: "refuse", reason: "payment_in_progress" };
  if (i.amountMinor > i.potMinor) return { kind: "refuse", reason: "not_enough_in_pot" };
  return { kind: "move", amountMinor: i.amountMinor };
}

/**
 * Filling pots when money arrives (D-084). Each bill may have a level to keep its pot at; new money fills pots up to
 * their levels, soonest bill first, and whatever is left stays free. Only the new money is used: free money already
 * there stays where the person left it.
 */
export function planAutoFill(
  incomingMinor: Minor,
  pots: readonly { lineId: string; potMinor: Minor; targetMinor: Minor | null }[],
): { lineId: string; amountMinor: Minor }[] {
  if (incomingMinor <= 0n) return [];
  let left = incomingMinor;
  const moves: { lineId: string; amountMinor: Minor }[] = [];
  for (const p of pots) {
    if (left === 0n) break;
    if (p.targetMinor === null || p.targetMinor <= 0n) continue;
    const gap = p.targetMinor - (p.potMinor > 0n ? p.potMinor : 0n);
    if (gap <= 0n) continue;
    const amount = gap < left ? gap : left;
    moves.push({ lineId: p.lineId, amountMinor: amount });
    left -= amount;
  }
  return moves;
}
