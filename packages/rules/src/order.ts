/**
 * Order state machine. Invariants 7, 8, 11, 13.
 *
 *   ready ──start──▶ vending ──token──▶ token_stored ──notify_start──▶ notifying ──notified──▶ settled
 *                      │  │                                              │   ▲
 *                      │  └─ambiguous──▶ needs_human ──resolved_token──▶ │   └─notify_failed (resend stored token)
 *                      └─rejected──▶ failed        └──resolved_failed──▶ failed
 *
 * `vending` covers both "call in flight" and "partner accepted, token pending".
 * It leaves only on a token from the signed webhook or fetch(partnerRef), a
 * definitive rejection, or a human. HTTP 200 on the vend call is not a token.
 */

export type OrderState =
  | "ready"
  | "vending"
  | "token_stored"
  | "notifying"
  | "settled"
  | "failed"
  | "needs_human";

export type OrderEvent =
  /** Worker is about to call the partner. Persisted before the HTTP call. */
  | { type: "start" }
  /** Partner accepted and returned a reference. Persist before anything else. */
  | { type: "accepted"; partnerRef: string }
  /** Token arrived via signed webhook or fetch(partnerRef). */
  | { type: "token" }
  /** Partner definitively rejected, with nothing accepted. Safe to release the money. */
  | { type: "rejected" }
  /**
   * Anything we cannot prove either way: a crash with no saved partnerRef, a
   * ledger-partner disagreement, an unknown error that outlived its window.
   */
  | { type: "ambiguous" }
  | { type: "notify_start" }
  | { type: "notified" }
  /** SMS failed. Stay put; the stored token is resent. Never buy again. */
  | { type: "notify_failed" }
  | { type: "resolved_token" }
  | { type: "resolved_failed" };

const TRANSITIONS: Record<OrderState, Partial<Record<OrderEvent["type"], OrderState>>> = {
  ready: { start: "vending", rejected: "failed" },
  vending: { accepted: "vending", token: "token_stored", rejected: "failed", ambiguous: "needs_human" },
  token_stored: { notify_start: "notifying" },
  notifying: { notified: "settled", notify_failed: "notifying" },
  settled: {},
  failed: {},
  needs_human: { resolved_token: "token_stored", resolved_failed: "failed" },
};

export class IllegalTransition extends Error {
  constructor(
    readonly from: OrderState,
    readonly event: OrderEvent["type"],
  ) {
    super(`order: ${event} is not allowed from ${from}`);
  }
}

export function nextOrderState(from: OrderState, event: OrderEvent): OrderState {
  const to = TRANSITIONS[from][event.type];
  if (!to) throw new IllegalTransition(from, event.type);
  return to;
}

/** States that still hold the site's single open-order slot. */
export const OPEN_ORDER_STATES: readonly OrderState[] = [
  "ready",
  "vending",
  "token_stored",
  "notifying",
  "needs_human",
];

export function isOpen(state: OrderState): boolean {
  return OPEN_ORDER_STATES.includes(state);
}

/**
 * The worker restarted and found an order in `vending`. What now?
 *
 * With a saved partnerRef, ask the partner (fetch) and never vend again.
 * Without one, we cannot know whether the partner took the money. Stop, freeze
 * this site only, and page a human. Invariant 8.
 */
export type RecoveryAction = { kind: "fetch"; partnerRef: string } | { kind: "needs_human_and_freeze_site" };

export function recoverVending(partnerRef: string | null): RecoveryAction {
  return partnerRef ? { kind: "fetch", partnerRef } : { kind: "needs_human_and_freeze_site" };
}

/**
 * When the negative ledger entries (vend, and fee per D-020) are written.
 * Invariant: at acceptance, not at SMS. A rejected order never wrote one; a failed-after-acceptance order is
 * reversed by a refund entry written by a human resolution.
 */
export function writesVendLedgerEntry(event: OrderEvent): boolean {
  return event.type === "accepted";
}
