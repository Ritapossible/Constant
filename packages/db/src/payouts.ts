/** Naira withdrawals (D-067). The amount is held in the ledger the moment it's requested, and given back only on a definite failure. */
import { withdrawalLedgerKey } from "@constant/rules";
import { insertLedger } from "./repo.js";
import type { Q, Tx } from "./pool.js";

export interface PayoutAccountRow {
  user_id: string;
  provider: string;
  bank_code: string;
  bank_name: string;
  account_last4: string;
  account_name: string;
  recipient_code: string;
  updated_at: Date;
}

export async function getPayoutAccount(q: Q, userId: string): Promise<PayoutAccountRow | null> {
  return (await q.query<PayoutAccountRow>("SELECT * FROM payout_accounts WHERE user_id = $1", [userId])).rows[0] ?? null;
}

export async function upsertPayoutAccount(q: Q, a: Omit<PayoutAccountRow, "updated_at">): Promise<PayoutAccountRow> {
  const r = await q.query<PayoutAccountRow>(
    `INSERT INTO payout_accounts (user_id, provider, bank_code, bank_name, account_last4, account_name, recipient_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET provider = $2, bank_code = $3, bank_name = $4, account_last4 = $5, account_name = $6, recipient_code = $7, updated_at = now()
     RETURNING *`,
    [a.user_id, a.provider, a.bank_code, a.bank_name, a.account_last4, a.account_name, a.recipient_code],
  );
  return r.rows[0]!;
}

export type WithdrawalStatus = "requested" | "sent" | "succeeded" | "failed" | "reversed" | "needs_human";

export interface WithdrawalRow {
  id: string;
  user_id: string;
  amount_minor: bigint;
  currency: string;
  recipient_code: string;
  reference: string;
  status: WithdrawalStatus;
  transfer_code: string | null;
  error: string | null;
  checks: number;
  next_check_at: Date;
  created_at: Date;
  updated_at: Date;
}

/** Records the request and holds the money, in the caller's transaction (user row locked). */
export async function insertWithdrawal(tx: Tx, w: { id: string; userId: string; amountMinor: bigint; currency: string; recipientCode: string; reference: string }): Promise<WithdrawalRow> {
  const r = await tx.query<WithdrawalRow>(
    "INSERT INTO withdrawals (id, user_id, amount_minor, currency, recipient_code, reference, status) VALUES ($1,$2,$3,$4,$5,$6,'requested') RETURNING *",
    [w.id, w.userId, w.amountMinor, w.currency, w.recipientCode, w.reference],
  );
  await insertLedger(tx, { userId: w.userId, kind: "withdrawal", amountMinor: -w.amountMinor, currency: w.currency, idempotencyKey: withdrawalLedgerKey(w.userId, w.id), externalRef: w.reference, actor: "user" });
  return r.rows[0]!;
}

export async function lockWithdrawal(tx: Tx, id: string): Promise<WithdrawalRow | null> {
  return (await tx.query<WithdrawalRow>("SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE", [id])).rows[0] ?? null;
}

export async function withdrawalByReference(q: Q, reference: string): Promise<WithdrawalRow | null> {
  return (await q.query<WithdrawalRow>("SELECT * FROM withdrawals WHERE reference = $1", [reference])).rows[0] ?? null;
}

export async function claimableWithdrawals(q: Q, now: Date, limit = 20): Promise<string[]> {
  return (await q.query<{ id: string }>("SELECT id FROM withdrawals WHERE status IN ('requested','sent') AND next_check_at <= $1 ORDER BY next_check_at LIMIT $2", [now, limit])).rows.map((r) => r.id);
}

export async function listWithdrawals(q: Q, userId: string, limit = 20): Promise<WithdrawalRow[]> {
  return (await q.query<WithdrawalRow>("SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, limit])).rows;
}

export async function updateWithdrawal(q: Q, id: string, patch: Partial<{ status: WithdrawalStatus; transfer_code: string | null; error: string | null; checks: number; next_check_at: Date }>): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await q.query(`UPDATE withdrawals SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}

/** Gives the held money back after a definite failure or reversal. Once per withdrawal. */
export async function refundWithdrawal(tx: Tx, w: WithdrawalRow, why: string): Promise<void> {
  await insertLedger(tx, { userId: w.user_id, kind: "refund", amountMinor: w.amount_minor, currency: w.currency, idempotencyKey: `ledger:refund:withdrawal:${w.id}`, externalRef: w.reference, actor: why });
}
