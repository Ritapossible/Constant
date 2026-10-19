/** Sign-in sessions (D-080). The API records each identity-provider session and refuses old or idle ones. */
import type { Q } from "./pool.js";

export interface SessionRow {
  sid: string;
  user_id: string;
  created_at: Date;
  last_seen_at: Date;
  user_agent: string | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

export async function getSession(q: Q, sid: string): Promise<SessionRow | null> {
  return (await q.query<SessionRow>("SELECT * FROM sessions WHERE sid = $1", [sid])).rows[0] ?? null;
}

/** Records a session the first time it is seen. A sid already recorded keeps its owner and start time. */
export async function recordSession(q: Q, s: { sid: string; userId: string; userAgent: string | null; now: Date }): Promise<SessionRow> {
  const r = await q.query<SessionRow>(
    `INSERT INTO sessions (sid, user_id, created_at, last_seen_at, user_agent) VALUES ($1, $2, $3, $3, $4)
     ON CONFLICT (sid) DO UPDATE SET sid = EXCLUDED.sid RETURNING *`,
    [s.sid, s.userId, s.now, s.userAgent?.slice(0, 200) ?? null],
  );
  return r.rows[0]!;
}

export async function touchSession(q: Q, sid: string, now: Date): Promise<void> {
  await q.query("UPDATE sessions SET last_seen_at = $2 WHERE sid = $1 AND revoked_at IS NULL", [sid, now]);
}

export async function revokeSession(q: Q, sid: string, reason: string, now: Date): Promise<void> {
  await q.query("UPDATE sessions SET revoked_at = $2, revoked_reason = $3 WHERE sid = $1 AND revoked_at IS NULL", [sid, now, reason]);
}

/** Signs a user out everywhere: every session they have is refused from now on. Returns how many. */
export async function revokeAllSessions(q: Q, userId: string, reason: string, now: Date): Promise<number> {
  const r = await q.query("UPDATE sessions SET revoked_at = $2, revoked_reason = $3 WHERE user_id = $1 AND revoked_at IS NULL", [userId, now, reason]);
  return r.rowCount ?? 0;
}

export async function activeSessions(q: Q, userId: string): Promise<SessionRow[]> {
  return (await q.query<SessionRow>("SELECT * FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC", [userId])).rows;
}
