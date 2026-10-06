/**
 * Delivering tokens and codes on the channel the user chose (D-054).
 *
 * Channels: WhatsApp, Telegram, SMS, email. The user orders them; Constant
 * tries the first, and moves to the next only if it fails or isn't confirmed
 * in time. Every attempt resends the SAME stored token. Delivery never buys.
 */

export type Channel = "whatsapp" | "telegram" | "sms" | "email";

export interface DeliveryAttempt {
  channel: Channel;
  at: Date;
  /** sent: provider accepted it. delivered: provider confirmed it reached the device. */
  status: "sent" | "delivered" | "failed";
}

export interface DeliveryInput {
  /** The user's order of preference, e.g. ["telegram", "sms"]. */
  preferred: readonly Channel[];
  /** Channels actually usable for this recipient (Telegram linked, email verified, WhatsApp opted in…). */
  linked: Readonly<Partial<Record<Channel, boolean>>>;
  attempts: readonly DeliveryAttempt[];
  now: Date;
  /** Move to the next channel if a "sent" message isn't confirmed within this. Default 5 minutes. */
  fallbackAfterMinutes: number;
}

export type DeliveryStep =
  | { kind: "send"; channel: Channel }
  | { kind: "wait"; until: Date }
  | { kind: "done"; channel: Channel }
  /** Every usable channel was tried. Tell the owner and support; never buy again. */
  | { kind: "exhausted" };

/**
 * Email has no reliable "delivered" receipt, so an accepted email counts as
 * delivered once its wait has passed and nothing later is left to try.
 */
export function nextDeliveryStep(i: DeliveryInput): DeliveryStep {
  const delivered = i.attempts.find((a) => a.status === "delivered");
  if (delivered) return { kind: "done", channel: delivered.channel };

  const usable = dedupe(i.preferred).filter((c) => i.linked[c] === true);
  // SMS is the floor for a token: it works on any phone. Add it last if the user has a number for it.
  if (!usable.includes("sms") && i.linked.sms === true) usable.push("sms");

  const waitMs = i.fallbackAfterMinutes * 60_000;
  for (const channel of usable) {
    const tries = i.attempts.filter((a) => a.channel === channel);
    if (tries.length === 0) return { kind: "send", channel };
    const last = tries[tries.length - 1]!;
    if (last.status === "failed") continue;
    // status "sent": still waiting for confirmation?
    const until = new Date(last.at.getTime() + waitMs);
    if (i.now.getTime() < until.getTime()) return { kind: "wait", until };
  }

  const acceptedEmail = i.attempts.find((a) => a.channel === "email" && a.status === "sent");
  if (acceptedEmail) return { kind: "done", channel: "email" };
  return { kind: "exhausted" };
}

function dedupe(cs: readonly Channel[]): Channel[] {
  return [...new Set(cs)];
}
