/**
 * Idempotency keys for requests that move money (D-087). A key belongs to one intended action, not to one network
 * attempt: if the person taps "Withdraw" again after "Can't reach ConstantUnits", the retry carries the same key, so
 * the server replays the first answer instead of paying twice.
 *
 * A key is kept only while the outcome is unknown: the request didn't get an answer (offline), the server was still
 * working on it (409), or it failed on the server's side (5xx, which the server releases for a retry anyway). Any
 * definite answer ends the action, so the same request made deliberately later (a second ₦5,000 withdrawal, a retry
 * after topping up) gets a new key and is judged afresh.
 */

/** How long an unanswered action is remembered. The server keeps keys for 24 hours; a retry is minutes, not hours. */
export const PENDING_KEY_TTL_MS = 30 * 60_000;

export type KeyOutcome = "answered" | "unknown";

/** 0 is "no response at all"; 409 is "still processing"; 5xx and 429 are released by the server for a retry. */
export function outcomeOf(status: number): KeyOutcome {
  return status === 0 || status === 409 || status === 429 || status >= 500 ? "unknown" : "answered";
}

export class PendingKeys {
  private readonly keys = new Map<string, { key: string; at: number }>();

  constructor(
    private readonly newKey: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  /** The action's identity: the same method, path and body is the same action. */
  static fingerprint(method: string, path: string, body: unknown): string {
    return `${method} ${path}\n${body === undefined ? "" : JSON.stringify(body)}`;
  }

  /** The key for this action: the one still waiting on an answer, or a new one. */
  keyFor(fingerprint: string): string {
    const t = this.now();
    for (const [fp, v] of this.keys) if (t - v.at > PENDING_KEY_TTL_MS) this.keys.delete(fp);
    const held = this.keys.get(fingerprint);
    if (held) return held.key;
    const key = this.newKey();
    this.keys.set(fingerprint, { key, at: t });
    return key;
  }

  /** Called with every response status (0 when there was none). */
  settle(fingerprint: string, status: number): void {
    if (outcomeOf(status) === "answered") this.keys.delete(fingerprint);
  }

  /** On sign-out: nothing of one session carries into the next. */
  clear(): void {
    this.keys.clear();
  }
}
