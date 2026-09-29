/**
 * Idempotency keys. Each is a unique column in Postgres, so a duplicate webhook,
 * a retried job or a second scan inserts nothing. Invariants 6 and 7.
 */

/** One scheduled order per site per slot. */
export function scheduleOrderKey(siteId: string, scheduledFor: Date): string {
  return `order:schedule:${siteId}:${scheduledFor.toISOString()}`;
}

/** One LOW order per inbound message, whatever the provider retries. */
export function lowOrderKey(siteId: string, providerMessageId: string): string {
  return `order:low:${siteId}:${providerMessageId}`;
}

/** The negative ledger entry for an order. Written once, at acceptance. */
export function vendLedgerKey(orderId: string): string {
  return `ledger:vend:${orderId}`;
}

export function refundLedgerKey(orderId: string): string {
  return `ledger:refund:${orderId}`;
}

export function fundLedgerKey(provider: string, providerEventId: string): string {
  return `ledger:fund:${provider}:${providerEventId}`;
}

/** Owner notices that must go out at most once, e.g. "Thursday's buy did not run". */
export function noticeKey(siteId: string, notice: string, scheduledFor: Date): string {
  return `notice:${notice}:${siteId}:${scheduledFor.toISOString()}`;
}
