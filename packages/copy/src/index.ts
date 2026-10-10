/**
 * Customer-facing messages, English (Nigeria). Pidgin comes next (PLAN step 7).
 * Rules: local currency only, no chain words (CLAUDE.md rule 10), never a full smartcard, meter or token.
 */

import { renderStables, type StableNoticeKind, type StableParams } from "./stables.js";

export type NoticeKind =
  | "renewed"
  | "renewal_failed"
  | "insufficient"
  | "above_cap"
  | "funded"
  | "needs_attention"
  | "withdrawal_sent"
  | "withdrawal_failed"
  | StableNoticeKind;

export interface Message {
  subject: string;
  text: string;
}

/** ₦19,950 or ₦19,950.50. Integer kobo in, never a float. */
export function naira(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const k = abs % 100n;
  return `${neg ? "-" : ""}₦${whole}${k ? "." + k.toString().padStart(2, "0") : ""}`;
}

const day = (iso: string) =>
  new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));

export interface NoticeParams {
  name?: string;
  line?: string;
  provider?: string;
  last4?: string;
  amountMinor?: string;
  capMinor?: string;
  shortMinor?: string;
  dueAt?: string;
  balanceMinor?: string;
  bank?: string;
}

/** One message per notice kind. Short enough for one SMS where it may go by SMS. */
export function render(kind: NoticeKind, p: NoticeParams & Record<string, string | undefined>): Message {
  const who = p.line ?? `${p.provider ?? "TV"} ••${p.last4 ?? ""}`;
  const amt = p.amountMinor ? naira(BigInt(p.amountMinor)) : "";
  switch (kind) {
    case "renewed":
      return {
        subject: `${who} renewed`,
        text: `Constant: ${who} renewed for ${amt}.${p.dueAt ? ` Next renewal ${day(p.dueAt)}.` : ""}`,
      };
    case "renewal_failed":
      return {
        subject: `${who} was not renewed`,
        text: `Constant: we couldn't renew ${who}. No money was taken. We'll try again, or open the app to check the decoder.`,
      };
    case "insufficient":
      return {
        subject: `Add money to renew ${who}`,
        text: `Constant: ${who} renews ${p.dueAt ? day(p.dueAt) : "soon"} for ${amt}. You are ${p.shortMinor ? naira(BigInt(p.shortMinor)) : "a little"} short. Add money and we'll renew it.`,
      };
    case "above_cap":
      return {
        subject: `${who} costs more now`,
        text: `Constant: ${who} now costs ${amt}, above your limit of ${p.capMinor ? naira(BigInt(p.capMinor)) : "your limit"}. We won't pay it until you raise the limit in the app.`,
      };
    case "funded":
      return {
        subject: `${amt} added`,
        text: `Constant: ${amt} added to your account.${p.balanceMinor ? ` Balance ${naira(BigInt(p.balanceMinor))}.` : ""}`,
      };
    case "withdrawal_sent":
      return {
        subject: `${amt} is on its way`,
        text: `Constant: ${amt} sent to your ${p.bank ?? "bank"} account ••${p.last4 ?? ""}. It usually arrives within minutes.`,
      };
    case "withdrawal_failed":
      return {
        subject: `Withdrawal didn't go through`,
        text: `Constant: we couldn't send ${amt} to your bank. It's back in your Constant balance. Check your bank details in the app.`,
      };
    case "needs_attention":
      return {
        subject: `We're checking ${who}`,
        text: `Constant: a payment for ${who} needs a person to confirm it. We've paused this bill and will message you soon. Your money is safe.`,
      };
    default:
      return renderStables(kind, p as StableParams);
  }
}
