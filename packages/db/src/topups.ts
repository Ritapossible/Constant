/** Card, USSD and QR top-ups through Paystack Checkout (D-075). Saved before the provider is called. */
import type { Q } from "./pool.js";

export type TopupStatus = "pending" | "credited" | "failed" | "mismatch";

export interface TopupRow {
  id: string;
  user_id: string;
  provider: string;
  reference: string;
  credit_minor: bigint;
  fee_minor: bigint;
  total_minor: bigint;
  currency: string;
  status: TopupStatus;
  authorization_url: string | null;
  provider_event_id: string | null;
  channel: string | null;
  paid_minor: bigint | null;
  provider_fee_minor: bigint | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function insertTopup(
  q: Q,
  t: { userId: string; provider: string; reference: string; creditMinor: bigint; feeMinor: bigint; totalMinor: bigint },
): Promise<TopupRow> {
  const r = await q.query<TopupRow>(
    `INSERT INTO topups (user_id, provider, reference, credit_minor, fee_minor, total_minor, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
    [t.userId, t.provider, t.reference, t.creditMinor, t.feeMinor, t.totalMinor],
  );
  return r.rows[0]!;
}

export async function topupForUser(q: Q, userId: string, id: string): Promise<TopupRow | null> {
  return (await q.query<TopupRow>(`SELECT * FROM topups WHERE id = $1 AND user_id = $2`, [id, userId])).rows[0] ?? null;
}

/** Locks the top-up for settling, in the caller's transaction. */
export async function lockTopupByReference(q: Q, reference: string): Promise<TopupRow | null> {
  return (await q.query<TopupRow>(`SELECT * FROM topups WHERE reference = $1 FOR UPDATE`, [reference])).rows[0] ?? null;
}

export async function pendingTopupsToday(q: Q, userId: string): Promise<number> {
  const r = await q.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM topups WHERE user_id = $1 AND status = 'pending' AND created_at > now() - interval '1 day'",
    [userId],
  );
  return r.rows[0]!.n;
}

export async function updateTopup(
  q: Q,
  id: string,
  patch: Partial<Pick<TopupRow, "status" | "authorization_url" | "provider_event_id" | "channel" | "paid_minor" | "provider_fee_minor" | "error">>,
): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await q.query(`UPDATE topups SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}
