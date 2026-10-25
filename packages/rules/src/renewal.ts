/**
 * decideRenewal: buy or do-not-buy for a line that renews on a date (cable TV, D-041).
 *
 * The renewal scan calls this for every line whose next_run_at is due. Nothing else
 * may approve a renewal or compute its amount. The amount always comes from a fresh,
 * side-effect-free quote from the partner (decoder lookup), never from the client.
 */
import { DAY_MS, addDays, localDate, localParts, zonedInstant } from "./time.js";
import type { Minor } from "./types.js";

export type LineStatus = "active" | "paused" | "frozen" | "cancelled";

/** A fresh lookup of the decoder at the partner, made just before deciding. */
export interface RenewalQuote {
  /** What the provider charges to renew the current plan now. */
  amountMinor: Minor;
  /** When the current subscription ends, if the provider said. */
  dueAt: Date | null;
}

export interface RenewalInput {
  vendingEnabled: boolean;
  status: LineStatus;
  /** The decoder was looked up and confirmed by the user when the line was created. */
  verified: boolean;
  /** next_run_at being served. */
  runAt: Date;
  now: Date;
  /** Null when the partner could not be reached or did not return a price. */
  quote: RenewalQuote | null;
  /** The most the user agreed to pay for one renewal. A price above it is asked about, never paid (INV-39). */
  capMinor: Minor;
  /** Constant's fee for this product (D-031: cable is sold at face value, so usually 0). */
  feeMinor: Minor;
  /** Money the user can spend now: ledger sum minus money committed to open orders. */
  availableMinor: Minor;
  /** Any order for this line is still open. */
  hasOpenOrder: boolean;
  lastRenewedAt: Date | null;
  minDaysBetweenRenewals?: number;
  /** Usage lines: the most to spend on this line in any 7 days, and what was spent in the last 7 (D-079). */
  weeklyCapMinor?: Minor | null;
  spentLast7DaysMinor?: Minor;
}

export type RenewalSkipReason =
  | "killed"
  | "cancelled"
  | "paused"
  | "frozen"
  | "unverified"
  | "not_due"
  | "in_flight"
  | "too_soon"
  | "no_quote"
  | "already_renewed"
  | "misconfigured"
  | "above_cap"
  | "weekly_cap"
  | "insufficient";

export type RenewalDecision =
  | { kind: "renew"; amountMinor: Minor; feeMinor: Minor }
  | { kind: "do_not_renew"; reason: RenewalSkipReason };

/** A subscription that still has more than this long to run was renewed elsewhere (by the user, at a shop). */
export const ALREADY_RENEWED_DAYS = 3;
export const DEFAULT_MIN_DAYS_BETWEEN_RENEWALS = 20;
/** Renewals run at 07:00 local, the day before the subscription ends. */
export const RENEWAL_RUN_MINUTE_LOCAL = 7 * 60;

const no = (reason: RenewalSkipReason): RenewalDecision => ({ kind: "do_not_renew", reason });

/**
 * Order of checks: safety, then the line's own state, then timing, then what the
 * provider says, then money. The first failing reason is what the user hears.
 */
export function decideRenewal(i: RenewalInput): RenewalDecision {
  if (!i.vendingEnabled) return no("killed");
  if (i.status === "cancelled") return no("cancelled");
  if (i.status === "paused") return no("paused");
  if (i.status === "frozen") return no("frozen");
  if (!i.verified) return no("unverified");
  if (i.runAt.getTime() > i.now.getTime()) return no("not_due");
  if (i.hasOpenOrder) return no("in_flight");
  const minDays = i.minDaysBetweenRenewals ?? DEFAULT_MIN_DAYS_BETWEEN_RENEWALS;
  if (i.lastRenewedAt !== null && i.now.getTime() - i.lastRenewedAt.getTime() < minDays * DAY_MS) {
    return no("too_soon");
  }
  if (i.quote === null) return no("no_quote");
  if (i.quote.dueAt !== null && i.quote.dueAt.getTime() - i.now.getTime() > ALREADY_RENEWED_DAYS * DAY_MS) {
    return no("already_renewed");
  }
  if (i.quote.amountMinor <= 0n || i.capMinor <= 0n || i.feeMinor < 0n) return no("misconfigured");
  if (i.quote.amountMinor > i.capMinor) return no("above_cap");
  if (i.weeklyCapMinor != null && (i.spentLast7DaysMinor ?? 0n) + i.quote.amountMinor > i.weeklyCapMinor) return no("weekly_cap");
  if (i.availableMinor < i.quote.amountMinor + i.feeMinor) return no("insufficient");
  return { kind: "renew", amountMinor: i.quote.amountMinor, feeMinor: i.feeMinor };
}

/**
 * What the scan does after deciding.
 *
 * - vend: insert the order (keyed by line + runAt) and enqueue it, in one transaction.
 * - reschedule: move next_run_at to `runAt`.
 * - notify_and_hold: tell the user once for this cycle, keep next_run_at, and try again
 *   on the next scan, so money added later the same day still renews in time.
 * - hold: try again on the next scan; nothing to tell.
 */
export type RenewalAction =
  | { kind: "vend"; amountMinor: Minor; feeMinor: Minor }
  | { kind: "reschedule"; runAt: Date }
  | { kind: "notify_and_hold"; notice: "insufficient" | "above_cap" | "weekly_cap" }
  | { kind: "hold" };

export function renewalAction(d: RenewalDecision, i: Pick<RenewalInput, "quote" | "runAt">, timeZone: string): RenewalAction {
  if (d.kind === "renew") return { kind: "vend", amountMinor: d.amountMinor, feeMinor: d.feeMinor };
  switch (d.reason) {
    case "already_renewed":
      // dueAt is non-null whenever this reason is returned.
      return { kind: "reschedule", runAt: renewalRunAt(i.quote!.dueAt!, timeZone) };
    case "too_soon":
      return { kind: "reschedule", runAt: renewalRunAt(nextDueAfter(i.runAt, timeZone), timeZone) };
    case "insufficient":
    case "above_cap":
    case "weekly_cap":
      return { kind: "notify_and_hold", notice: d.reason };
    case "killed":
    case "cancelled":
    case "paused":
    case "frozen":
    case "unverified":
    case "not_due":
    case "in_flight":
    case "no_quote":
    case "misconfigured":
      return { kind: "hold" };
  }
}

/** 07:00 local on the day before the subscription ends. */
export function renewalRunAt(dueAt: Date, timeZone: string): Date {
  return zonedInstant(addDays(localDate(dueAt, timeZone), -1), RENEWAL_RUN_MINUTE_LOCAL, timeZone);
}

/**
 * The same local day one month later, clamped to the month's last day
 * (31 January → 28 or 29 February).
 */
export function nextDueAfter(dueAt: Date, timeZone: string): Date {
  const d = localDate(dueAt, timeZone);
  const year = d.month === 12 ? d.year + 1 : d.year;
  const month = d.month === 12 ? 1 : d.month + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return zonedInstant({ year, month, day: Math.min(d.day, last) }, RENEWAL_RUN_MINUTE_LOCAL, timeZone);
}

/**
 * Monthly bills (D-079): 07:00 local on `renewDay` (1 to 28) of this month if that is still ahead of `now`,
 * otherwise of next month.
 */
export function monthlyRunAt(renewDay: number, now: Date, timeZone: string): Date {
  if (!Number.isInteger(renewDay) || renewDay < 1 || renewDay > 28) throw new Error("renewDay must be 1 to 28");
  const today = localDate(now, timeZone);
  const thisMonth = zonedInstant({ year: today.year, month: today.month, day: renewDay }, RENEWAL_RUN_MINUTE_LOCAL, timeZone);
  if (thisMonth.getTime() >= now.getTime()) return thisMonth;
  const year = today.month === 12 ? today.year + 1 : today.year;
  const month = today.month === 12 ? 1 : today.month + 1;
  return zonedInstant({ year, month, day: renewDay }, RENEWAL_RUN_MINUTE_LOCAL, timeZone);
}

/** After a monthly payment for the run at `paidFor`: the same day next month (days 1 to 28 exist in every month). */
export function nextMonthlyRunAt(renewDay: number, paidFor: Date, timeZone: string): Date {
  return monthlyRunAt(renewDay, new Date(paidFor.getTime() + 1), timeZone);
}

/** Usage lines: at most one top-up in this many days, however often the user reports it low. */
export const USAGE_MIN_DAYS_BETWEEN_TOPUPS = 0.25;
/** Monthly lines: never twice in this many days. */
export const MONTHLY_MIN_DAYS_BETWEEN_PAYMENTS = 20;

/**
 * Money a user can spend now. Open orders have not written their ledger entries yet
 * (that happens on delivery), so their amount and fee are held back here. Without
 * this, two lines due on the same morning could both spend the same naira.
 */
export function availableBalance(ledgerSumMinor: Minor, committedToOpenOrdersMinor: Minor): Minor {
  if (committedToOpenOrdersMinor < 0n) throw new Error("availableBalance: committed must be >= 0");
  return ledgerSumMinor - committedToOpenOrdersMinor;
}

// ── Reminders while a bill waits on the person (D-091) ────────────────────────────

/**
 * A held bill (not enough money, or above its limit) is told about once when it's first held. These reminders follow
 * as the service's end comes close, so nobody finds out from a dark screen:
 *   due_soon   within a day of the end
 *   last_call  within the last 6 hours, or from 8 pm the evening before an early-morning end
 * Never between 10 pm and 7 am local time, and never within a few hours of the previous message (an hour for the
 * last call, which can't wait). Each is sent at most once a cycle (the caller keys it); a bill with no known end
 * (usage-based data and power) gets only the first message.
 */
export const HOLD_REMINDER = {
  dueSoonHours: 24,
  lastCallHours: 6,
  /** From this local hour, an end within lastCallEveningHours counts as the last call: it's the last waking chance. */
  eveningHour: 20,
  lastCallEveningHours: 14,
  quietFromHour: 22,
  quietUntilHour: 7,
  minGapHours: 3,
  lastCallMinGapHours: 1,
} as const;

export type HoldReminderStage = "due_soon" | "last_call";

export function holdReminder(i: { now: Date; dueAt: Date | null; lastNotifiedAt: Date | null; timeZone: string }): HoldReminderStage | null {
  const R = HOLD_REMINDER;
  if (!i.dueAt || i.now.getTime() >= i.dueAt.getTime()) return null;
  const { hour } = localParts(i.now, i.timeZone);
  if (hour >= R.quietFromHour || hour < R.quietUntilHour) return null;
  const hoursLeft = (i.dueAt.getTime() - i.now.getTime()) / 3_600_000;
  const lastCall = hoursLeft <= R.lastCallHours || (hour >= R.eveningHour && hoursLeft <= R.lastCallEveningHours);
  if (!lastCall && hoursLeft > R.dueSoonHours) return null;
  const sinceLast = i.lastNotifiedAt ? (i.now.getTime() - i.lastNotifiedAt.getTime()) / 3_600_000 : Infinity;
  if (sinceLast < (lastCall ? R.lastCallMinGapHours : R.minGapHours)) return null;
  return lastCall ? "last_call" : "due_soon";
}
