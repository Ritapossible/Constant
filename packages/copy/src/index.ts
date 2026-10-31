/**
 * Customer-facing messages, English (Nigeria). Pidgin comes next (PLAN step 7).
 * Rules: local currency only, no chain words (CLAUDE.md rule 10), never a full smartcard, meter or phone number.
 * The one exception is the electricity token, which goes only to its owner in the "token" message: it's what they paid for.
 */

import { renderStables, type StableNoticeKind, type StableParams } from "./stables.js";
import { renderSubscription, type SubscriptionNoticeKind, type SubscriptionParams } from "./subscriptions.js";

export { isGsm7, smsParts, toSmsText } from "./sms.js";
export { emailFor, type Email, type EmailContext } from "./email.js";
export { merchantPrice, SUBSCRIPTION_KINDS } from "./subscriptions.js";

export type NoticeKind =
  | "renewed"
  | "renewal_failed"
  | "insufficient"
  | "above_cap"
  | "funded"
  | "needs_attention"
  | "withdrawal_sent"
  | "withdrawal_failed"
  | "topped_up"
  | "token"
  | "bill_paid"
  | "weekly_cap"
  | "kyc_verified"
  | "kyc_failed"
  | "bill_due_soon"
  | "bill_last_call"
  | "running_low"
  | "welcome"
  | SubscriptionNoticeKind
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

/** "Thu 12 Nov, 6 pm": when a held bill's service ends. */
function dayTime(iso: string): string {
  const parts: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).formatToParts(new Date(iso)))
    parts[x.type] = x.value;
  const h24 = Number(parts.hour) % 24;
  const h = h24 % 12 || 12;
  const min = parts.minute === "00" ? "" : `:${parts.minute}`;
  return `${parts.weekday} ${parts.day} ${parts.month}, ${h}${min} ${h24 < 12 ? "am" : "pm"}`;
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
  /** Electricity: the token (added at send time from the encrypted order, never stored in the notice). */
  token?: string;
  units?: string;
  nextAt?: string;
  /** Money added: how much went into bill pots (D-084). */
  setAsideMinor?: string;
  /** Why an identity check failed, already in plain words (D-086). */
  reason?: string;
  /** Why a bill is waiting on the person: "insufficient", "above_cap" or "weekly_cap" (D-091). */
  held?: string;
  /** Running low (D-092): when the line will likely run low, from the person's readings. */
  likelyAt?: string;
  /** A bill paid from the person's own stablecoins (D-093): what left their account: "<amount> <token> on <network>". */
  paidWith?: string;
  /** Welcome (D-093): "1" while bill payments are still switched off (the preview). */
  preview?: string;
}

/** " Paid with <amount> <token> on <network>." when a bill was paid from the person's own stablecoins (D-093). */
const paid = (p: NoticeParams) => (p.paidWith ? ` Paid with ${p.paidWith}.` : "");

/** One message per notice kind. Short enough for one SMS where it may go by SMS. */
export function render(kind: NoticeKind, p: NoticeParams & Record<string, string | undefined>): Message {
  const who = p.line ?? `${p.provider ?? "TV"} ••${p.last4 ?? ""}`;
  const amt = p.amountMinor ? naira(BigInt(p.amountMinor)) : "";
  switch (kind) {
    case "renewed":
      return {
        subject: `${who} renewed`,
        text: `ConstantUnits: ${who} renewed for ${amt}.${p.dueAt ? ` Next renewal ${day(p.dueAt)}.` : ""}${paid(p)}`,
      };
    case "renewal_failed":
      return {
        subject: `${who} was not paid`,
        text: `ConstantUnits: we couldn't pay ${who}. No money was taken. We'll try again, or open the app to check the bill.`,
      };
    case "insufficient":
      return {
        subject: `Add money for ${who}`,
        text: `ConstantUnits: ${who} is due ${p.dueAt ? day(p.dueAt) : "now"} for ${amt}. You are ${p.shortMinor ? naira(BigInt(p.shortMinor)) : "a little"} short. Add money and we'll pay it.`,
      };
    case "above_cap":
      return {
        subject: `${who} costs more now`,
        text: `ConstantUnits: ${who} now costs ${amt}, above your limit of ${p.capMinor ? naira(BigInt(p.capMinor)) : "your limit"}. We won't pay it until you raise the limit in the app.`,
      };
    case "topped_up":
      return {
        subject: `${who} topped up`,
        text: `ConstantUnits: ${who} topped up with ${amt}.${p.nextAt ? ` Next on ${day(p.nextAt)}.` : ""}${paid(p)}`,
      };
    case "token":
      return {
        subject: `Your token for ${who}`,
        text: `ConstantUnits: ${amt} token for ${who}${p.units ? ` (${p.units} kWh)` : ""}: ${p.token ?? "open the app to see it"}. Enter it on your meter.`,
      };
    case "bill_paid":
      return {
        subject: `${who} paid`,
        text: `ConstantUnits: ${who} paid, ${amt}.${p.nextAt ? ` Next on ${day(p.nextAt)}.` : ""}${paid(p)}`,
      };
    case "bill_due_soon":
    case "bill_last_call": {
      // Reminders while a bill waits on the person (D-091): what's missing, and what one step fixes it.
      const ends = p.dueAt ? dayTime(p.dueAt) : "soon";
      const fix =
        p.held === "insufficient"
          ? `Add ${p.shortMinor ? naira(BigInt(p.shortMinor)) : "money"} and we'll pay it within minutes.`
          : `It's ${amt}, above your limit: raise it in the app and we'll pay it.`;
      return kind === "bill_due_soon"
        ? { subject: `${who} ends ${ends}`, text: `ConstantUnits: reminder, ${who} ends ${ends}, unpaid. ${fix}` }
        : { subject: `Last reminder: ${who}`, text: `ConstantUnits: last reminder, ${who} ends ${ends}. ${fix}` };
    }
    case "welcome":
      // Sent once, when the account is made (D-093). Never promises payments while they're switched off.
      return {
        subject: "Your ConstantUnits account is ready",
        text:
          p.preview === "1"
            ? "ConstantUnits: your account is ready. Add a bill, set its limit and add money. Bill payments switch on soon."
            : "ConstantUnits: your account is ready. Add a bill, set its limit and add money, and we'll pay it on the day you choose.",
      };
    case "running_low": {
      // From the person's own readings (D-092): nothing measures the line, so the fix includes a fresh reading.
      const when = p.likelyAt ? `by ${dayTime(p.likelyAt)}` : "soon";
      return {
        subject: `${who} is running low`,
        text: `ConstantUnits: ${who} will likely run low ${when}. Tap Top up now in the app, or add today's balance.`,
      };
    }
    case "weekly_cap":
      return {
        subject: `${who} reached its weekly limit`,
        text: `ConstantUnits: ${who} reached its weekly limit of ${p.capMinor ? naira(BigInt(p.capMinor)) : "your limit"}. We'll top up when the week allows, or raise it in the app.`,
      };
    case "kyc_verified":
      return {
        subject: "You're verified",
        text: "ConstantUnits: your identity is verified. You can now get your own account number for bank transfers, and withdraw to your bank.",
      };
    case "kyc_failed":
      return {
        subject: "We couldn't verify you yet",
        text: `ConstantUnits: we couldn't verify your identity. ${p.reason ?? "Check your details and try again."}`,
      };
    case "funded":
      return {
        subject: `${amt} added`,
        text: `ConstantUnits: ${amt} added to your account.${p.setAsideMinor ? ` ${naira(BigInt(p.setAsideMinor))} set aside for your bills.` : ""}${p.balanceMinor ? ` Balance ${naira(BigInt(p.balanceMinor))}.` : ""}`,
      };
    case "withdrawal_sent":
      return {
        subject: `${amt} is on its way`,
        text: `ConstantUnits: ${amt} sent to your ${p.bank ?? "bank"} account ••${p.last4 ?? ""}. It usually arrives within minutes.`,
      };
    case "withdrawal_failed":
      return {
        subject: `Withdrawal didn't go through`,
        text: `ConstantUnits: we couldn't send ${amt} to your bank. It's back in your ConstantUnits balance. Check your bank details in the app.`,
      };
    case "needs_attention":
      return {
        subject: `We're checking ${who}`,
        text: `ConstantUnits: a payment for ${who} needs a person to confirm it. We've paused this bill and will message you soon. Your money is safe.`,
      };
    case "subscription_soon":
    case "subscription_tomorrow":
      return renderSubscription(kind, p as SubscriptionParams);
    default:
      return renderStables(kind, p as StableParams);
  }
}
