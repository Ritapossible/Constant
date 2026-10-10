/** Repositories for the review guards (D-064): screening, flags, the daily limit, sweeps, paging once. */
import type { Q } from "./pool.js";

export type ScreeningState = "pending" | "clear" | "flagged" | "not_required";

/** Pages a person once per dedupe key (e.g. per hour), however often the condition is seen. */
export async function raiseOpsAlertOnce(q: Q, severity: "page" | "warn", kind: string, dedupeKey: string, detail: Record<string, unknown>): Promise<boolean> {
  const r = await q.query("INSERT INTO ops_alerts (severity, kind, detail, dedupe_key) VALUES ($1,$2,$3,$4) ON CONFLICT (dedupe_key) DO NOTHING", [
    severity,
    kind,
    JSON.stringify(detail),
    dedupeKey,
  ]);
  return r.rowCount === 1;
}

export async function flag(q: Q, key: string, fallback = false): Promise<boolean> {
  const r = await q.query<{ value: boolean }>("SELECT value FROM system_flags WHERE key = $1", [key]);
  return r.rows[0]?.value ?? fallback;
}

export async function setFlag(q: Q, key: string, value: boolean, by: string, reason: string): Promise<void> {
  await q.query(
    `INSERT INTO system_flags (key, value, changed_by, reason) VALUES ($1,$2,$3,$4)
     ON CONFLICT (key) DO UPDATE SET value = $2, changed_by = $3, reason = $4, changed_at = now()`,
    [key, value, by, reason],
  );
}

/** USDC (micro) charged in the 24 hours before `now`, counting charges already sent but not yet confirmed. */
export async function charged24hMicro(q: Q, now: Date): Promise<bigint> {
  const r = await q.query<{ s: string }>(
    `SELECT COALESCE(SUM(usdc_micro), 0)::text AS s FROM charges
     WHERE status IN ('submitted', 'confirmed') AND COALESCE(submitted_at, created_at) > $1::timestamptz - interval '24 hours'`,
    [now],
  );
  return BigInt(r.rows[0]!.s);
}

/**
 * Screening state of everything that funds this account: the account itself and every address that sent it
 * an accepted token. Flagged beats pending beats clear.
 */
export async function accountScreening(q: Q, account: string): Promise<"clear" | "pending" | "flagged"> {
  const r = await q.query<{ s: string }>(
    `SELECT screening AS s FROM user_addresses WHERE lower(address) = lower($1)
     UNION ALL
     SELECT screening FROM chain_deposits WHERE lower(address) = lower($1) AND status = 'accepted'`,
    [account],
  );
  const states = r.rows.map((x) => x.s);
  if (states.includes("flagged")) return "flagged";
  if (states.length === 0 || states.includes("pending")) return "pending";
  return "clear";
}

export async function depositsToScreen(q: Q, limit = 50): Promise<{ chain: string; tx_hash: string; log_index: number; from_address: string; user_id: string }[]> {
  return (
    await q.query(
      "SELECT chain, tx_hash, log_index, from_address, user_id FROM chain_deposits WHERE screening = 'pending' AND status = 'accepted' ORDER BY created_at LIMIT $1",
      [limit],
    )
  ).rows;
}

export async function setDepositScreening(q: Q, d: { chain: string; tx_hash: string; log_index: number }, s: ScreeningState): Promise<void> {
  await q.query("UPDATE chain_deposits SET screening = $4 WHERE chain = $1 AND tx_hash = $2 AND log_index = $3", [d.chain, d.tx_hash, d.log_index, s]);
}

export async function addressesToScreen(q: Q, limit = 50): Promise<{ address: string; user_id: string }[]> {
  return (await q.query("SELECT address, user_id FROM user_addresses WHERE screening = 'pending' ORDER BY created_at LIMIT $1", [limit])).rows;
}

export async function setAddressScreening(q: Q, address: string, s: ScreeningState): Promise<void> {
  await q.query("UPDATE user_addresses SET screening = $2 WHERE lower(address) = lower($1)", [address, s]);
}

export async function freezeUser(q: Q, userId: string, reason: string): Promise<void> {
  await q.query("UPDATE users SET status = 'frozen', frozen_reason = $2, updated_at = now() WHERE id = $1", [userId, reason]);
}

export interface SweepRow {
  id: string;
  chain: string;
  token: string;
  to_address: string;
  amount: string;
  status: "submitted" | "confirmed" | "failed";
  tx_hash: string;
  tx_raw: string | null;
  created_at: Date;
}

export async function sweepInFlight(q: Q, chain: string, token: string): Promise<SweepRow | null> {
  return (await q.query<SweepRow>("SELECT * FROM sweeps WHERE chain = $1 AND token = $2 AND status = 'submitted'", [chain, token])).rows[0] ?? null;
}

/** Saved before it is sent. Returns false if another sweep is already in flight. */
export async function insertSweep(q: Q, s: { chain: string; token: string; to: string; amount: bigint; txHash: string; txRaw: string }): Promise<boolean> {
  try {
    await q.query("INSERT INTO sweeps (chain, token, to_address, amount, status, tx_hash, tx_raw) VALUES ($1,$2,$3,$4,'submitted',$5,$6)", [
      s.chain,
      s.token,
      s.to,
      s.amount.toString(),
      s.txHash,
      s.txRaw,
    ]);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return false;
    throw err;
  }
}

export async function markSweep(q: Q, id: string, status: "confirmed" | "failed"): Promise<void> {
  await q.query("UPDATE sweeps SET status = $2, tx_raw = NULL, confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE NULL END WHERE id = $1", [id, status]);
}
