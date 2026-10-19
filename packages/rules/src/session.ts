/**
 * Sign-in sessions (D-080). A session the API hasn't seen for `idleDays`, or that started more than `maxDays`
 * ago, is over: the person signs in again, whatever the identity provider would still refresh. Money stays
 * safe with a stolen phone or a leaked token that nobody is actively using.
 */
import { DAY_MS } from "./time.js";

export const SESSION_IDLE_DAYS = 7;
export const SESSION_MAX_DAYS = 30;
/** Write last_seen_at at most this often per session, so a busy app doesn't write on every request. */
export const SESSION_TOUCH_EVERY_MS = 5 * 60_000;

export interface SessionState {
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export type SessionDecision =
  | { kind: "allow"; touch: boolean }
  | { kind: "revoke"; reason: "idle" | "max_age" }
  | { kind: "refuse" };

export function decideSession(s: SessionState | null, now: Date, policy: { idleDays: number; maxDays: number } = { idleDays: SESSION_IDLE_DAYS, maxDays: SESSION_MAX_DAYS }): SessionDecision {
  if (!(policy.idleDays > 0) || !(policy.maxDays > 0)) throw new Error("session policy must be positive");
  if (s === null) return { kind: "allow", touch: true }; // first sight: the caller records it
  if (s.revokedAt !== null) return { kind: "refuse" };
  const t = now.getTime();
  if (t - s.createdAt.getTime() > policy.maxDays * DAY_MS) return { kind: "revoke", reason: "max_age" };
  if (t - s.lastSeenAt.getTime() > policy.idleDays * DAY_MS) return { kind: "revoke", reason: "idle" };
  return { kind: "allow", touch: t - s.lastSeenAt.getTime() >= SESSION_TOUCH_EVERY_MS };
}
