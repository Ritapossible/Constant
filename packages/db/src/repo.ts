/**
 * Repositories. Plain SQL, small functions, each taking whatever can run a query.
 * Functions that move money expect to be called inside withTx with the user row locked.
 */
import { feeLedgerKey, fundLedgerKey, nextOrderState, vendLedgerKey, type OrderEvent, type OrderState } from "@constant/rules";
import type { Q, Tx } from "./pool.js";

// ── Users ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  privy_did: string;
  display_name: string | null;
  email: string | null;
  phone_e164: string | null;
  market_code: string;
  status: "active" | "frozen";
  created_at: Date;
}

export async function upsertUser(
  q: Q,
  u: { privyDid: string; email?: string | null; phoneE164?: string | null },
): Promise<UserRow> {
  const r = await q.query<UserRow>(
    `INSERT INTO users (privy_did, email, phone_e164) VALUES ($1, $2, $3)
     ON CONFLICT (privy_did) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, users.email),
       phone_e164 = COALESCE(EXCLUDED.phone_e164, users.phone_e164),
       updated_at = now()
     RETURNING *`,
    [u.privyDid, u.email ?? null, u.phoneE164 ?? null],
  );
  return r.rows[0]!;
}

export async function getUserByDid(q: Q, privyDid: string): Promise<UserRow | null> {
  return (await q.query<UserRow>("SELECT * FROM users WHERE privy_did = $1", [privyDid])).rows[0] ?? null;
}

export async function getUser(q: Q, id: string): Promise<UserRow | null> {
  return (await q.query<UserRow>("SELECT * FROM users WHERE id = $1", [id])).rows[0] ?? null;
}

/** Serialises everything that spends or credits this user's money. */
export async function lockUser(tx: Tx, id: string): Promise<UserRow> {
  const r = await tx.query<UserRow>("SELECT * FROM users WHERE id = $1 FOR UPDATE", [id]);
  if (!r.rows[0]) throw new Error("lockUser: no such user");
  return r.rows[0];
}

export async function setDisplayName(q: Q, id: string, name: string | null): Promise<void> {
  await q.query("UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1", [id, name]);
}

// ── Market config ────────────────────────────────────────────────────────────

export interface MarketRow {
  code: string;
  currency: string;
  time_zone: string;
}

export async function getMarket(q: Q, code: string): Promise<MarketRow> {
  const r = await q.query<MarketRow>("SELECT code, currency, time_zone FROM markets WHERE code = $1", [code]);
  if (!r.rows[0]) throw new Error(`no market ${code}`);
  return r.rows[0];
}

export async function feeFor(q: Q, market: string, kind: string): Promise<bigint> {
  const r = await q.query<{ fee_minor: bigint }>("SELECT fee_minor FROM fees WHERE market_code = $1 AND kind = $2", [market, kind]);
  if (!r.rows[0]) throw new Error(`no fee configured for ${market}/${kind}`);
  return r.rows[0].fee_minor;
}

export async function providerEnabled(q: Q, code: string, kind: string): Promise<boolean> {
  const r = await q.query<{ enabled: boolean }>("SELECT enabled FROM providers WHERE code = $1 AND kind = $2", [code, kind]);
  return r.rows[0]?.enabled ?? false;
}

export async function vendingEnabled(q: Q): Promise<boolean> {
  const r = await q.query<{ value: boolean }>("SELECT value FROM system_flags WHERE key = 'vending_enabled'");
  return r.rows[0]?.value ?? false;
}

export async function setVendingEnabled(q: Q, value: boolean, by: string, reason: string): Promise<void> {
  await q.query(
    `INSERT INTO system_flags (key, value, changed_by, reason) VALUES ('vending_enabled', $1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $1, changed_by = $2, reason = $3, changed_at = now()`,
    [value, by, reason],
  );
}

// ── Lines ────────────────────────────────────────────────────────────────────

export type LineStatus = "active" | "paused" | "frozen" | "cancelled";

export interface LineRow {
  id: string;
  user_id: string;
  kind: "tv";
  provider: string;
  ref_ciphertext: string;
  ref_hmac: string;
  ref_last4: string;
  customer_name: string | null;
  plan_name: string | null;
  nickname: string;
  currency: string;
  cap_minor: bigint;
  status: LineStatus;
  frozen_reason: string | null;
  verified: boolean;
  due_at: Date | null;
  next_run_at: Date | null;
  last_renewed_at: Date | null;
  created_at: Date;
}

export interface NewLine {
  userId: string;
  kind: "tv";
  provider: string;
  refCiphertext: string;
  refHmac: string;
  refLast4: string;
  customerName: string | null;
  planName: string | null;
  nickname: string;
  currency: string;
  capMinor: bigint;
  dueAt: Date | null;
  nextRunAt: Date | null;
}

export class DuplicateLine extends Error {}

export async function insertLine(q: Q, l: NewLine): Promise<LineRow> {
  try {
    const r = await q.query<LineRow>(
      `INSERT INTO lines (user_id, kind, provider, ref_ciphertext, ref_hmac, ref_last4, customer_name, plan_name,
                          nickname, currency, cap_minor, verified, due_at, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13) RETURNING *`,
      [l.userId, l.kind, l.provider, l.refCiphertext, l.refHmac, l.refLast4, l.customerName, l.planName, l.nickname, l.currency, l.capMinor, l.dueAt, l.nextRunAt],
    );
    return r.rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new DuplicateLine("this decoder is already on your account");
    throw err;
  }
}

export async function listLines(q: Q, userId: string): Promise<LineRow[]> {
  return (await q.query<LineRow>("SELECT * FROM lines WHERE user_id = $1 AND status <> 'cancelled' ORDER BY created_at", [userId])).rows;
}

export async function getLine(q: Q, id: string, userId?: string): Promise<LineRow | null> {
  const r = userId
    ? await q.query<LineRow>("SELECT * FROM lines WHERE id = $1 AND user_id = $2", [id, userId])
    : await q.query<LineRow>("SELECT * FROM lines WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function lockLine(tx: Tx, id: string): Promise<LineRow> {
  const r = await tx.query<LineRow>("SELECT * FROM lines WHERE id = $1 FOR UPDATE", [id]);
  if (!r.rows[0]) throw new Error("lockLine: no such line");
  return r.rows[0];
}

/** Lines whose renewal is due. Read without locks; each is re-checked under lock before acting. */
export async function dueLineIds(q: Q, now: Date, limit = 50): Promise<string[]> {
  const r = await q.query<{ id: string }>(
    "SELECT id FROM lines WHERE status = 'active' AND next_run_at <= $1 ORDER BY next_run_at LIMIT $2",
    [now, limit],
  );
  return r.rows.map((x) => x.id);
}

export async function updateLine(
  q: Q,
  id: string,
  patch: Partial<{ status: LineStatus; frozen_reason: string | null; cap_minor: bigint; nickname: string; due_at: Date | null; next_run_at: Date | null; last_renewed_at: Date; plan_name: string | null }>,
): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await q.query(`UPDATE lines SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}

// ── Ledger ───────────────────────────────────────────────────────────────────

export type LedgerKind = "fund" | "vend" | "fee" | "refund" | "adjust" | "reversal" | "withdrawal";

export interface LedgerInsert {
  userId: string;
  lineId?: string | null;
  orderId?: string | null;
  kind: LedgerKind;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  externalRef?: string | null;
  actor: string;
}

/** Inserts once. Returns false if the key already exists (a replay), true if written. */
export async function insertLedger(q: Q, e: LedgerInsert): Promise<boolean> {
  if (e.amountMinor === 0n) return false;
  const r = await q.query(
    `INSERT INTO ledger_entries (user_id, line_id, order_id, kind, amount_minor, currency, idempotency_key, external_ref, actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING`,
    [e.userId, e.lineId ?? null, e.orderId ?? null, e.kind, e.amountMinor, e.currency, e.idempotencyKey, e.externalRef ?? null, e.actor],
  );
  return r.rowCount === 1;
}

export async function ledgerSum(q: Q, userId: string): Promise<bigint> {
  const r = await q.query<{ s: bigint }>("SELECT COALESCE(SUM(amount_minor), 0)::bigint AS s FROM ledger_entries WHERE user_id = $1", [userId]);
  return r.rows[0]!.s;
}

/** Amount + fee of open orders that have not written their vend entry yet (INV-52). */
export async function committedToOpenOrders(q: Q, userId: string): Promise<bigint> {
  const r = await q.query<{ s: bigint }>(
    `SELECT COALESCE(SUM(o.amount_minor + o.fee_minor), 0)::bigint AS s FROM orders o
     WHERE o.user_id = $1 AND o.state IN ('ready','vending','token_stored','notifying','needs_human')
       AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.idempotency_key = 'ledger:vend:' || o.id::text)`,
    [userId],
  );
  return r.rows[0]!.s;
}

export interface LedgerRow {
  id: bigint;
  kind: LedgerKind;
  amount_minor: bigint;
  currency: string;
  line_id: string | null;
  order_id: string | null;
  created_at: Date;
}

export async function recentLedger(q: Q, userId: string, limit = 30): Promise<LedgerRow[]> {
  return (
    await q.query<LedgerRow>(
      "SELECT id, kind, amount_minor, currency, line_id, order_id, created_at FROM ledger_entries WHERE user_id = $1 ORDER BY id DESC LIMIT $2",
      [userId, limit],
    )
  ).rows;
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface OrderRow {
  id: string;
  user_id: string;
  line_id: string;
  trigger: "renewal";
  state: OrderState;
  amount_minor: bigint;
  fee_minor: bigint;
  currency: string;
  idempotency_key: string;
  scheduled_for: Date | null;
  partner: string;
  partner_ref: string | null;
  partner_txn_id: string | null;
  checks: number;
  next_check_at: Date | null;
  error: string | null;
  receipt_id: string;
  created_at: Date;
  updated_at: Date;
  settled_at: Date | null;
}

export interface NewOrder {
  userId: string;
  lineId: string;
  amountMinor: bigint;
  feeMinor: bigint;
  currency: string;
  idempotencyKey: string;
  scheduledFor: Date;
  partner: string;
  receiptId: string;
}

/** Inserts the order in `ready`. Returns null if the key exists or the line already has an open order. */
export async function insertOrder(tx: Tx, o: NewOrder): Promise<OrderRow | null> {
  await tx.query("SAVEPOINT insert_order");
  try {
    const r = await tx.query<OrderRow>(
      `INSERT INTO orders (user_id, line_id, trigger, state, amount_minor, fee_minor, currency, idempotency_key, scheduled_for, partner, receipt_id, next_check_at)
       VALUES ($1,$2,'renewal','ready',$3,$4,$5,$6,$7,$8,$9, now()) RETURNING *`,
      [o.userId, o.lineId, o.amountMinor, o.feeMinor, o.currency, o.idempotencyKey, o.scheduledFor, o.partner, o.receiptId],
    );
    await tx.query("RELEASE SAVEPOINT insert_order");
    const row = r.rows[0]!;
    await tx.query("INSERT INTO order_events (order_id, from_state, to_state, event, actor) VALUES ($1, NULL, 'ready', 'created', 'scan')", [row.id]);
    return row;
  } catch (err) {
    await tx.query("ROLLBACK TO SAVEPOINT insert_order");
    if ((err as { code?: string }).code === "23505") return null;
    throw err;
  }
}

export async function hasOpenOrder(q: Q, lineId: string): Promise<boolean> {
  const r = await q.query(
    "SELECT 1 FROM orders WHERE line_id = $1 AND state IN ('ready','vending','token_stored','notifying','needs_human') LIMIT 1",
    [lineId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function lockOrder(tx: Tx, id: string): Promise<OrderRow> {
  const r = await tx.query<OrderRow>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
  if (!r.rows[0]) throw new Error("lockOrder: no such order");
  return r.rows[0];
}

export async function getOrder(q: Q, id: string): Promise<OrderRow | null> {
  return (await q.query<OrderRow>("SELECT * FROM orders WHERE id = $1", [id])).rows[0] ?? null;
}

export async function orderByPartnerRef(q: Q, partnerRef: string): Promise<OrderRow | null> {
  return (await q.query<OrderRow>("SELECT * FROM orders WHERE partner_ref = $1", [partnerRef])).rows[0] ?? null;
}

/** Orders the worker should act on now: new ones, and vending ones whose next check is due. */
export async function claimableOrderIds(q: Q, now: Date, limit = 20): Promise<string[]> {
  const r = await q.query<{ id: string }>(
    `SELECT id FROM orders WHERE state IN ('ready','vending') AND next_check_at <= $1 ORDER BY next_check_at LIMIT $2`,
    [now, limit],
  );
  return r.rows.map((x) => x.id);
}

export async function ordersInState(q: Q, state: OrderState): Promise<OrderRow[]> {
  return (await q.query<OrderRow>("SELECT * FROM orders WHERE state = $1", [state])).rows;
}

export async function listOrders(q: Q, userId: string, limit = 20): Promise<OrderRow[]> {
  return (await q.query<OrderRow>("SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, limit])).rows;
}

/**
 * Moves an order through the state machine in `packages/rules` and records the event.
 * Must be called with the order row locked. Throws IllegalTransition for a move the machine forbids.
 */
export async function transition(
  tx: Tx,
  order: OrderRow,
  event: OrderEvent,
  patch: Partial<{ partner_ref: string; partner_txn_id: string; next_check_at: Date | null; checks: number; error: string | null; settled_at: Date }>,
  actor: string,
  detail?: Record<string, unknown>,
): Promise<OrderRow> {
  const to = nextOrderState(order.state, event);
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  const sets = ["state = $2", "updated_at = now()", ...keys.map((k, i) => `${k} = $${i + 3}`)].join(", ");
  const r = await tx.query<OrderRow>(`UPDATE orders SET ${sets} WHERE id = $1 RETURNING *`, [order.id, to, ...keys.map((k) => patch[k])]);
  await tx.query("INSERT INTO order_events (order_id, from_state, to_state, event, detail, actor) VALUES ($1,$2,$3,$4,$5,$6)", [
    order.id,
    order.state,
    to,
    event.type,
    detail ? JSON.stringify(detail) : null,
    actor,
  ]);
  return r.rows[0]!;
}

/** Updates bookkeeping on an order without changing its state (next check time, error text). */
export async function touchOrder(q: Q, id: string, patch: { next_check_at?: Date | null; checks?: number; error?: string | null }): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await q.query(`UPDATE orders SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}

/** The vend and fee entries for a delivered order, once, in the caller's transaction. */
export async function writeVendEntries(tx: Tx, o: OrderRow, partnerRef: string): Promise<void> {
  await insertLedger(tx, {
    userId: o.user_id,
    lineId: o.line_id,
    orderId: o.id,
    kind: "vend",
    amountMinor: -o.amount_minor,
    currency: o.currency,
    idempotencyKey: vendLedgerKey(o.id),
    externalRef: partnerRef,
    actor: "worker",
  });
  await insertLedger(tx, {
    userId: o.user_id,
    lineId: o.line_id,
    orderId: o.id,
    kind: "fee",
    amountMinor: -o.fee_minor,
    currency: o.currency,
    idempotencyKey: feeLedgerKey(o.id),
    actor: "worker",
  });
}

// ── Funding ──────────────────────────────────────────────────────────────────

export interface FundingAccountRow {
  user_id: string;
  provider: string;
  customer_code: string;
  account_number: string;
  bank_name: string;
  account_name: string;
}

export async function getFundingAccount(q: Q, userId: string): Promise<FundingAccountRow | null> {
  return (await q.query<FundingAccountRow>("SELECT * FROM funding_accounts WHERE user_id = $1", [userId])).rows[0] ?? null;
}

export async function insertFundingAccount(q: Q, a: FundingAccountRow): Promise<FundingAccountRow> {
  const r = await q.query<FundingAccountRow>(
    `INSERT INTO funding_accounts (user_id, provider, customer_code, account_number, bank_name, account_name)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING *`,
    [a.user_id, a.provider, a.customer_code, a.account_number, a.bank_name, a.account_name],
  );
  return r.rows[0]!;
}

export async function usersByCustomerCode(q: Q, provider: string, customerCode: string): Promise<string[]> {
  const r = await q.query<{ user_id: string }>("SELECT user_id FROM funding_accounts WHERE provider = $1 AND customer_code = $2", [provider, customerCode]);
  return r.rows.map((x) => x.user_id);
}

export async function saveInboundWebhook(q: Q, provider: string, signatureOk: boolean, raw: string): Promise<void> {
  await q.query("INSERT INTO inbound_webhooks (provider, signature_ok, raw) VALUES ($1,$2,$3)", [provider, signatureOk, raw]);
}

/** Records the funding event and credits the ledger in the caller's transaction. Replays write nothing. */
export async function recordFunding(
  tx: Tx,
  e: { provider: string; eventId: string; userId: string | null; amountMinor: bigint; currency: string; credit: boolean; reason?: string },
): Promise<"credited" | "rejected" | "duplicate"> {
  const r = await tx.query(
    `INSERT INTO funding_events (provider, provider_event_id, user_id, amount_minor, currency, status, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [e.provider, e.eventId, e.userId, e.amountMinor, e.currency, e.credit ? "credited" : "rejected", e.reason ?? null],
  );
  if (r.rowCount === 0) return "duplicate";
  if (!e.credit || !e.userId) return "rejected";
  await insertLedger(tx, {
    userId: e.userId,
    kind: "fund",
    amountMinor: e.amountMinor,
    currency: e.currency,
    idempotencyKey: fundLedgerKey(e.provider, e.eventId),
    externalRef: e.eventId,
    actor: e.provider,
  });
  return "credited";
}

export async function fundingEventExists(q: Q, provider: string, eventId: string): Promise<boolean> {
  const r = await q.query("SELECT 1 FROM funding_events WHERE provider = $1 AND provider_event_id = $2", [provider, eventId]);
  return (r.rowCount ?? 0) > 0;
}

// ── Notices and ops ──────────────────────────────────────────────────────────

export interface NoticeRow {
  id: bigint;
  idempotency_key: string;
  user_id: string;
  line_id: string | null;
  order_id: string | null;
  kind: string;
  params: Record<string, unknown>;
  status: "pending" | "sent" | "failed";
  attempts: number;
}

/** Queues a message once per key (INV-23). Returns false if it was already queued. */
export async function queueNotice(
  q: Q,
  n: { key: string; userId: string; lineId?: string | null; orderId?: string | null; kind: string; params?: Record<string, unknown> },
): Promise<boolean> {
  const r = await q.query(
    `INSERT INTO notices (idempotency_key, user_id, line_id, order_id, kind, params) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [n.key, n.userId, n.lineId ?? null, n.orderId ?? null, n.kind, JSON.stringify(n.params ?? {})],
  );
  return r.rowCount === 1;
}

export async function claimNotice(tx: Tx, now: Date): Promise<NoticeRow | null> {
  const r = await tx.query<NoticeRow>(
    `SELECT * FROM notices WHERE status = 'pending' AND next_attempt_at <= $1 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [now],
  );
  return r.rows[0] ?? null;
}

export async function markNotice(
  q: Q,
  id: bigint,
  patch: { status: "pending" | "sent" | "failed"; attempts: number; channel?: string | null; provider_msg_id?: string | null; error?: string | null; next_attempt_at?: Date },
): Promise<void> {
  await q.query(
    `UPDATE notices SET status = $2, attempts = $3, channel = COALESCE($4, channel), provider_msg_id = COALESCE($5, provider_msg_id),
       error = $6, next_attempt_at = COALESCE($7, next_attempt_at), sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
     WHERE id = $1`,
    [id, patch.status, patch.attempts, patch.channel ?? null, patch.provider_msg_id ?? null, patch.error ?? null, patch.next_attempt_at ?? null],
  );
}

export async function raiseOpsAlert(q: Q, severity: "page" | "warn", kind: string, detail: Record<string, unknown>): Promise<void> {
  await q.query("INSERT INTO ops_alerts (severity, kind, detail) VALUES ($1,$2,$3)", [severity, kind, JSON.stringify(detail)]);
}

/** A partner webhook named this request: check it now instead of waiting for the next scheduled check. */
export async function nudgeOrder(q: Q, partnerRef: string, now: Date): Promise<void> {
  await q.query("UPDATE orders SET next_check_at = $2 WHERE partner_ref = $1 AND state = 'vending'", [partnerRef, now]);
}
