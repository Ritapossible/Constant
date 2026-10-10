/** Repositories for spend permissions and on-chain charges (D-063). */
import type { Q, Tx } from "./pool.js";

export type PermissionStatus = "signed" | "approving" | "approved" | "revoke_pending" | "revoked" | "failed";

export interface PermissionRow {
  id: string;
  user_id: string;
  line_id: string;
  account: string;
  spender: string;
  token: string;
  allowance: string;
  period: bigint;
  start_at: bigint;
  end_at: bigint;
  salt: string;
  extra_data: string;
  signature: string;
  status: PermissionStatus;
  tx_hash: string | null;
  tx_raw: string | null;
  error: string | null;
  updated_at: Date;
}

export interface NewPermission {
  userId: string;
  lineId: string;
  account: string;
  spender: string;
  token: string;
  allowance: bigint;
  period: number;
  start: number;
  end: number;
  salt: bigint;
  extraData: string;
  signature: string;
}

export class PermissionExists extends Error {}

export async function insertPermission(q: Q, p: NewPermission): Promise<PermissionRow> {
  try {
    const r = await q.query<PermissionRow>(
      `INSERT INTO spend_permissions (user_id, line_id, account, spender, token, allowance, period, start_at, end_at, salt, extra_data, signature, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'signed') RETURNING *`,
      [p.userId, p.lineId, p.account, p.spender, p.token, p.allowance.toString(), p.period, p.start, p.end, p.salt.toString(), p.extraData, p.signature],
    );
    return r.rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new PermissionExists("this bill already has a permission");
    throw err;
  }
}

/** The usable or in-progress permission for a line, if any. */
export async function livePermission(q: Q, lineId: string): Promise<PermissionRow | null> {
  return (
    await q.query<PermissionRow>("SELECT * FROM spend_permissions WHERE line_id = $1 AND status IN ('signed','approving','approved') ORDER BY created_at DESC LIMIT 1", [lineId])
  ).rows[0] ?? null;
}

export async function getPermission(q: Q, id: string): Promise<PermissionRow | null> {
  return (await q.query<PermissionRow>("SELECT * FROM spend_permissions WHERE id = $1", [id])).rows[0] ?? null;
}

export async function permissionsInStatus(q: Q, statuses: PermissionStatus[]): Promise<PermissionRow[]> {
  return (await q.query<PermissionRow>("SELECT * FROM spend_permissions WHERE status = ANY($1) ORDER BY updated_at", [statuses])).rows;
}

export async function lockPermission(tx: Tx, id: string): Promise<PermissionRow> {
  const r = await tx.query<PermissionRow>("SELECT * FROM spend_permissions WHERE id = $1 FOR UPDATE", [id]);
  if (!r.rows[0]) throw new Error("lockPermission: no such permission");
  return r.rows[0];
}

export async function updatePermission(
  q: Q,
  id: string,
  patch: Partial<{ status: PermissionStatus; tx_hash: string | null; tx_raw: string | null; error: string | null }>,
): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await q.query(`UPDATE spend_permissions SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}

export type ChargeStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface ChargeRow {
  id: string;
  order_id: string;
  permission_id: string;
  usdc_micro: string;
  kobo_per_usdc: bigint;
  naira_minor: bigint;
  status: ChargeStatus;
  tx_hash: string | null;
  tx_raw: string | null;
  submitted_at: Date | null;
  error: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

export async function insertCharge(tx: Tx, c: { orderId: string; permissionId: string; usdcMicro: bigint; koboPerUsdc: bigint; nairaMinor: bigint }): Promise<ChargeRow> {
  const r = await tx.query<ChargeRow>(
    "INSERT INTO charges (order_id, permission_id, usdc_micro, kobo_per_usdc, naira_minor, status) VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *",
    [c.orderId, c.permissionId, c.usdcMicro.toString(), c.koboPerUsdc, c.nairaMinor],
  );
  return r.rows[0]!;
}

export async function chargeForOrder(q: Q, orderId: string): Promise<ChargeRow | null> {
  return (await q.query<ChargeRow>("SELECT * FROM charges WHERE order_id = $1", [orderId])).rows[0] ?? null;
}

export async function lockCharge(tx: Tx, orderId: string): Promise<ChargeRow | null> {
  return (await tx.query<ChargeRow>("SELECT * FROM charges WHERE order_id = $1 FOR UPDATE", [orderId])).rows[0] ?? null;
}

export async function updateCharge(
  q: Q,
  id: string,
  patch: Partial<{ status: ChargeStatus; tx_hash: string | null; tx_raw: string | null; submitted_at: Date | null; error: string | null; confirmed_at: Date | null }>,
): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await q.query(`UPDATE charges SET ${sets} WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}

export async function setLineFunding(q: Q, lineId: string, funding: "naira" | "usdc_base"): Promise<void> {
  await q.query("UPDATE lines SET funding = $2, updated_at = now() WHERE id = $1", [lineId, funding]);
}
