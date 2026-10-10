/** Operations: alerts, the audit trail of operator actions, and the numbers an operator checks first. */
import type { Q } from "./pool.js";

export interface AlertRow {
  id: bigint;
  severity: "page" | "warn";
  kind: string;
  detail: Record<string, unknown>;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  notified_at: Date | null;
}

export async function logOpsAction(q: Q, actor: string, action: string, target: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await q.query("INSERT INTO ops_actions (actor, action, target, detail) VALUES ($1,$2,$3,$4)", [actor, action, target, JSON.stringify(detail)]);
}

export async function listAlerts(q: Q, open: boolean, limit = 100): Promise<AlertRow[]> {
  return (
    await q.query<AlertRow>(`SELECT * FROM ops_alerts ${open ? "WHERE resolved_at IS NULL" : ""} ORDER BY id DESC LIMIT $1`, [limit])
  ).rows;
}

export async function resolveAlert(q: Q, id: string, by: string): Promise<boolean> {
  const r = await q.query("UPDATE ops_alerts SET resolved_at = now(), resolved_by = $2 WHERE id = $1 AND resolved_at IS NULL", [id, by]);
  return r.rowCount === 1;
}

/** Alerts not yet emailed, oldest first; marked in the same call so two workers never send the same one. */
export async function takeUnnotifiedAlerts(q: Q, limit = 50): Promise<AlertRow[]> {
  return (
    await q.query<AlertRow>(
      `UPDATE ops_alerts SET notified_at = now() WHERE id IN (
         SELECT id FROM ops_alerts WHERE notified_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [limit],
    )
  ).rows.sort((a, b) => Number(a.id - b.id));
}

export async function releaseAlerts(q: Q, ids: bigint[]): Promise<void> {
  if (ids.length) await q.query("UPDATE ops_alerts SET notified_at = NULL WHERE id = ANY($1)", [ids]);
}

export interface OpsSummary {
  flags: Record<string, boolean>;
  ordersByState: Record<string, number>;
  openAlerts: number;
  frozenLines: number;
  frozenUsers: number;
  lastReconciliation: { finished_at: Date | null; ok: boolean | null } | null;
}

export async function opsSummary(q: Q): Promise<OpsSummary> {
  const [flags, states, alerts, lines, users, recon] = await Promise.all([
    q.query<{ key: string; value: boolean }>("SELECT key, value FROM system_flags"),
    q.query<{ state: string; n: number }>("SELECT state, count(*)::int AS n FROM orders GROUP BY state"),
    q.query<{ n: number }>("SELECT count(*)::int AS n FROM ops_alerts WHERE resolved_at IS NULL"),
    q.query<{ n: number }>("SELECT count(*)::int AS n FROM lines WHERE status = 'frozen'"),
    q.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE status = 'frozen'"),
    q.query<{ finished_at: Date | null; ok: boolean | null }>("SELECT finished_at, ok FROM reconciliation_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1"),
  ]);
  return {
    flags: Object.fromEntries(flags.rows.map((r) => [r.key, r.value])),
    ordersByState: Object.fromEntries(states.rows.map((r) => [r.state, r.n])),
    openAlerts: alerts.rows[0]!.n,
    frozenLines: lines.rows[0]!.n,
    frozenUsers: users.rows[0]!.n,
    lastReconciliation: recon.rows[0] ?? null,
  };
}

export async function requestReconciliation(q: Q, actor: string): Promise<bigint> {
  const r = await q.query<{ id: bigint }>("INSERT INTO reconciliation_runs (actor) VALUES ($1) RETURNING id", [actor]);
  return r.rows[0]!.id;
}
