import { describe, expect, it } from "vitest";
import { PENDING_KEY_TTL_MS, PendingKeys, outcomeOf } from "../lib/app/idempotency";

const setup = () => {
  let n = 0;
  let t = 1_000_000;
  const keys = new PendingKeys(
    () => `key-${++n}`,
    () => t,
  );
  return { keys, advance: (ms: number) => (t += ms) };
};
const fp = PendingKeys.fingerprint("POST", "/v1/withdrawals", { amountMinor: "500000" });

describe("idempotency keys (D-087)", () => {
  it("a retry after no answer carries the same key, so the server applies it once", () => {
    const { keys } = setup();
    const first = keys.keyFor(fp);
    keys.settle(fp, 0); // "Can't reach ConstantUnits"
    expect(keys.keyFor(fp)).toBe(first);
  });

  it("keeps the key while the server is still working on it, or failed on its side", () => {
    const { keys } = setup();
    const first = keys.keyFor(fp);
    for (const status of [409, 429, 500, 503]) {
      keys.settle(fp, status);
      expect(keys.keyFor(fp)).toBe(first);
    }
  });

  it("a definite answer ends the action: doing the same thing again later is a new request", () => {
    const { keys } = setup();
    for (const status of [200, 202, 204, 400, 403, 422]) {
      const before = keys.keyFor(fp);
      keys.settle(fp, status);
      expect(keys.keyFor(fp)).not.toBe(before);
    }
  });

  it("a different amount or route is a different action", () => {
    const { keys } = setup();
    const a = keys.keyFor(fp);
    const b = keys.keyFor(PendingKeys.fingerprint("POST", "/v1/withdrawals", { amountMinor: "600000" }));
    const c = keys.keyFor(PendingKeys.fingerprint("POST", "/v1/topups", { amountMinor: "500000" }));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("forgets an unanswered action after a while, and everything on sign-out", () => {
    const { keys, advance } = setup();
    const a = keys.keyFor(fp);
    advance(PENDING_KEY_TTL_MS + 1);
    expect(keys.keyFor(fp)).not.toBe(a);
    const b = keys.keyFor(fp);
    keys.clear();
    expect(keys.keyFor(fp)).not.toBe(b);
  });

  it("classifies statuses", () => {
    expect(outcomeOf(0)).toBe("unknown");
    expect(outcomeOf(201)).toBe("answered");
    expect(outcomeOf(404)).toBe("answered");
    expect(outcomeOf(502)).toBe("unknown");
  });
});
