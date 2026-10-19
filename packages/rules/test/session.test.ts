import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SESSION_IDLE_DAYS, SESSION_MAX_DAYS, SESSION_TOUCH_EVERY_MS, decideSession } from "../src/index.js";

const T = new Date("2026-11-01T09:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(T.getTime() + ms);

describe("sessions (D-080)", () => {
  it("a new session is allowed and recorded", () => {
    expect(decideSession(null, T)).toEqual({ kind: "allow", touch: true });
  });

  it("idle for more than 7 days: revoked", () => {
    const s = { createdAt: T, lastSeenAt: T, revokedAt: null };
    expect(decideSession(s, at(SESSION_IDLE_DAYS * DAY - 1)).kind).toBe("allow");
    expect(decideSession(s, at(SESSION_IDLE_DAYS * DAY + 1))).toEqual({ kind: "revoke", reason: "idle" });
  });

  it("older than 30 days: revoked even if used every day", () => {
    const s = { createdAt: T, lastSeenAt: at(SESSION_MAX_DAYS * DAY), revokedAt: null };
    expect(decideSession(s, at(SESSION_MAX_DAYS * DAY + 1))).toEqual({ kind: "revoke", reason: "max_age" });
  });

  it("a revoked session never comes back", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 * DAY }), (ms) => {
        expect(decideSession({ createdAt: T, lastSeenAt: at(ms), revokedAt: T }, at(ms)).kind).toBe("refuse");
      }),
    );
  });

  it("last-seen is written at most every few minutes", () => {
    const s = { createdAt: T, lastSeenAt: T, revokedAt: null };
    expect(decideSession(s, at(SESSION_TOUCH_EVERY_MS - 1))).toEqual({ kind: "allow", touch: false });
    expect(decideSession(s, at(SESSION_TOUCH_EVERY_MS))).toEqual({ kind: "allow", touch: true });
  });

  it("whatever the times, an allowed session was seen within the idle window and started within the max age", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 * DAY }), fc.integer({ min: 0, max: 60 * DAY }), (age, idle) => {
        const now = at(age);
        const s = { createdAt: T, lastSeenAt: new Date(Math.max(T.getTime(), now.getTime() - idle)), revokedAt: null };
        const d = decideSession(s, now);
        if (d.kind === "allow") {
          expect(now.getTime() - s.createdAt.getTime()).toBeLessThanOrEqual(SESSION_MAX_DAYS * DAY);
          expect(now.getTime() - s.lastSeenAt.getTime()).toBeLessThanOrEqual(SESSION_IDLE_DAYS * DAY);
        }
      }),
    );
  });
});
