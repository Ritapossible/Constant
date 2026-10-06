/**
 * Token delivery on the user's chosen channel, with fallback (D-054; INV-47 to INV-49).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nextDeliveryStep, type Channel, type DeliveryAttempt, type DeliveryInput } from "../src/index.js";

const now = new Date("2026-10-06T08:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const input = (over: Partial<DeliveryInput> = {}): DeliveryInput => ({
  preferred: ["telegram", "whatsapp", "email"],
  linked: { telegram: true, whatsapp: true, email: true, sms: true },
  attempts: [],
  now,
  fallbackAfterMinutes: 5,
  ...over,
});

describe("INV-47 the user's chosen channel goes first", () => {
  it("sends on the first preferred, linked channel", () => {
    expect(nextDeliveryStep(input())).toEqual({ kind: "send", channel: "telegram" });
  });
  it("skips a channel that isn't linked", () => {
    expect(nextDeliveryStep(input({ linked: { whatsapp: true, sms: true } }))).toEqual({ kind: "send", channel: "whatsapp" });
  });
});

describe("INV-48 fallback, ending in SMS", () => {
  it("waits for confirmation, then moves on", () => {
    const sent: DeliveryAttempt[] = [{ channel: "telegram", at: minsAgo(2), status: "sent" }];
    expect(nextDeliveryStep(input({ attempts: sent })).kind).toBe("wait");
    const late: DeliveryAttempt[] = [{ channel: "telegram", at: minsAgo(6), status: "sent" }];
    expect(nextDeliveryStep(input({ attempts: late }))).toEqual({ kind: "send", channel: "whatsapp" });
  });
  it("a failure moves on immediately", () => {
    const failed: DeliveryAttempt[] = [{ channel: "telegram", at: minsAgo(0), status: "failed" }];
    expect(nextDeliveryStep(input({ attempts: failed }))).toEqual({ kind: "send", channel: "whatsapp" });
  });
  it("SMS is the last resort even if the user didn't list it", () => {
    const tried: DeliveryAttempt[] = [
      { channel: "telegram", at: minsAgo(20), status: "failed" },
      { channel: "whatsapp", at: minsAgo(15), status: "failed" },
      { channel: "email", at: minsAgo(10), status: "failed" },
    ];
    expect(nextDeliveryStep(input({ attempts: tried }))).toEqual({ kind: "send", channel: "sms" });
  });
  it("stops once anything is delivered", () => {
    const ok: DeliveryAttempt[] = [{ channel: "telegram", at: minsAgo(1), status: "delivered" }];
    expect(nextDeliveryStep(input({ attempts: ok }))).toEqual({ kind: "done", channel: "telegram" });
  });
  it("an accepted email counts once nothing else is left", () => {
    const tried: DeliveryAttempt[] = [{ channel: "email", at: minsAgo(10), status: "sent" }];
    expect(nextDeliveryStep(input({ preferred: ["email"], linked: { email: true }, attempts: tried }))).toEqual({
      kind: "done",
      channel: "email",
    });
  });
  it("everything failed: exhausted, so support is told; never a new purchase", () => {
    const tried: DeliveryAttempt[] = [
      { channel: "telegram", at: minsAgo(9), status: "failed" },
      { channel: "sms", at: minsAgo(3), status: "failed" },
    ];
    expect(nextDeliveryStep(input({ preferred: ["telegram"], linked: { telegram: true, sms: true }, attempts: tried }))).toEqual({
      kind: "exhausted",
    });
  });
});

describe("INV-49 delivery never loops on one channel", () => {
  it("property: never sends twice on a channel that already has an attempt", () => {
    const ch = fc.constantFrom<Channel>("whatsapp", "telegram", "sms", "email");
    fc.assert(
      fc.property(
        fc.array(ch, { maxLength: 4 }),
        fc.array(fc.record({ channel: ch, ago: fc.integer({ min: 0, max: 60 }), status: fc.constantFrom("sent" as const, "failed" as const) }), {
          maxLength: 6,
        }),
        (preferred, raw) => {
          const attempts = raw.map((a) => ({ channel: a.channel, at: minsAgo(a.ago), status: a.status }));
          const step = nextDeliveryStep(input({ preferred, attempts }));
          if (step.kind === "send") expect(attempts.some((a) => a.channel === step.channel)).toBe(false);
        },
      ),
    );
  });
});
