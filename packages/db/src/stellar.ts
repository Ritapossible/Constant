/** Repositories for linked Stellar accounts and what users are asked to sign (D-085). */
import type { Q, Tx } from "./pool.js";

export class StellarAccountTaken extends Error {}

/** The user's linked Stellar account, if any. */
export async function stellarAccountOf(q: Q, userId: string): Promise<string | null> {
  const r = await q.query<{ address: string }>("SELECT address FROM user_addresses WHERE user_id = $1 AND family = 'stellar'", [userId]);
  return r.rows[0]?.address ?? null;
}

/**
 * Links `account` to the user, replacing a previous link. Refuses an account linked to someone else. Its screening
 * stays 'pending': the EVM screener skips Stellar accounts, and production holds Stellar charges until Stellar
 * screening exists (D-085, a go-live item).
 */
export async function linkStellarAccount(tx: Tx, userId: string, account: string): Promise<void> {
  const other = await tx.query<{ user_id: string }>("SELECT user_id FROM user_addresses WHERE family = 'stellar' AND address = $1", [account]);
  if (other.rows[0] && other.rows[0].user_id !== userId) throw new StellarAccountTaken("this Stellar account is linked to another ConstantUnits account");
  await tx.query("DELETE FROM user_addresses WHERE user_id = $1 AND family = 'stellar'", [userId]);
  await tx.query("INSERT INTO user_addresses (family, address, user_id, kind) VALUES ('stellar', $1, $2, 'external')", [account, userId]);
}

export interface StellarRequestRow {
  id: string;
  user_id: string;
  line_id: string | null;
  kind: "link" | "onboard" | "mandate";
  account: string;
  payload: string;
  data: Record<string, unknown>;
  expires_at: Date;
  used_at: Date | null;
}

export async function createStellarRequest(
  q: Q,
  r: { userId: string; lineId?: string | null; kind: StellarRequestRow["kind"]; account: string; payload: string; data: unknown; expiresAt: Date },
): Promise<StellarRequestRow> {
  const res = await q.query<StellarRequestRow>(
    `INSERT INTO stellar_requests (user_id, line_id, kind, account, payload, data, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [r.userId, r.lineId ?? null, r.kind, r.account, r.payload, JSON.stringify(r.data), r.expiresAt],
  );
  return res.rows[0]!;
}

/** Locks one request of this user and kind; null if it doesn't exist, was used, or lapsed. */
export async function lockStellarRequest(tx: Tx, id: string, userId: string, kind: StellarRequestRow["kind"], now: Date): Promise<StellarRequestRow | null> {
  const r = await tx.query<StellarRequestRow>(
    "SELECT * FROM stellar_requests WHERE id = $1 AND user_id = $2 AND kind = $3 AND used_at IS NULL AND expires_at > $4 FOR UPDATE",
    [id, userId, kind, now],
  );
  return r.rows[0] ?? null;
}

export async function useStellarRequest(tx: Tx, id: string, now: Date): Promise<void> {
  await tx.query("UPDATE stellar_requests SET used_at = $2 WHERE id = $1", [id, now]);
}
