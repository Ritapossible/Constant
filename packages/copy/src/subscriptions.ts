/**
 * Subscription renewal reminders (D-096). The only copy outside stables.ts allowed to show a merchant's own price
 * in dollars (D-039, CLAUDE.md rule 10); scripts/guard.sh allow-lists this file. ConstantUnits doesn't pay these
 * yet, so the message never says it will: the merchant charges the card on the person's own account.
 */
import type { Message } from "./index.js";

export type SubscriptionNoticeKind = "subscription_soon" | "subscription_tomorrow";

export const SUBSCRIPTION_KINDS: ReadonlySet<string> = new Set(["subscription_soon", "subscription_tomorrow"]);

export interface SubscriptionParams {
  line?: string;
  /** 07:00 local on the renewal day. */
  renewsAt?: string;
  /** The merchant's price in its smallest unit (cents). */
  priceMinor?: string;
  currency?: string;
}

/** "$20" or "$19.99"; another currency by its code. */
export function merchantPrice(minor: string | undefined, currency: string | undefined): string | null {
  if (!minor || !/^\d+$/.test(minor)) return null;
  const n = BigInt(minor);
  const whole = (n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = n % 100n;
  const amount = `${whole}${cents ? "." + cents.toString().padStart(2, "0") : ""}`;
  return !currency || currency === "USD" ? `$${amount}` : `${currency} ${amount}`;
}

const day = (iso: string) =>
  new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));

export function renderSubscription(kind: SubscriptionNoticeKind, p: SubscriptionParams): Message {
  const who = p.line ?? "Your subscription";
  const price = merchantPrice(p.priceMinor, p.currency);
  const forPrice = price ? ` for ${price}` : "";
  if (kind === "subscription_tomorrow") {
    return {
      subject: `${who} renews tomorrow`,
      text: `ConstantUnits: ${who} renews tomorrow${forPrice}, charged to the card on that account. Check the card can pay, or cancel today.`,
    };
  }
  const when = p.renewsAt ? `on ${day(p.renewsAt)}` : "soon";
  return {
    subject: `${who} renews ${when}`,
    text: `ConstantUnits: ${who} renews ${when}${forPrice}, charged to the card on that account. To stop it, cancel before then.`,
  };
}
