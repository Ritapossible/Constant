/**
 * Renewal reminders for subscriptions (D-096). ConstantUnits doesn't pay subscriptions yet (D-039): the merchant
 * charges the card on the person's own account. So the reminder is the whole service: a few days' notice, then the
 * day before, in waking hours, each once a renewal.
 */
import { localDate, localParts, zonedInstant, type LocalDate } from "./time.js";

export const SUBSCRIPTION_REMINDER = {
  /** "Renews soon" goes out when the renewal is this many days away or fewer (and more than one). */
  soonDays: 3,
  /** Sent from this local hour... */
  fromHour: 9,
  /** ...until this one. Later than the running-low window starts, earlier than it ends: not a 7 am buzz. */
  untilHour: 20,
  /** The renewal instant used for the date in the message and the once-a-renewal key: 07:00 local. */
  renewMinuteLocal: 7 * 60,
} as const;

export type SubscriptionReminderStage = "soon" | "tomorrow";

export interface SubscriptionReminder {
  stage: SubscriptionReminderStage;
  /** 07:00 local on the renewal day: the date to show, and the key so each stage is sent once a renewal. */
  renewsAt: Date;
}

/** Whole days from one local date to another. */
function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** The next renewal on or after today, as a local date. Days 1 to 28 exist in every month. */
export function nextRenewalDate(renewDay: number, now: Date, timeZone: string): LocalDate {
  if (!Number.isInteger(renewDay) || renewDay < 1 || renewDay > 28) throw new Error("renewDay must be 1 to 28");
  const today = localDate(now, timeZone);
  if (today.day <= renewDay) return { year: today.year, month: today.month, day: renewDay };
  return today.month === 12 ? { year: today.year + 1, month: 1, day: renewDay } : { year: today.year, month: today.month + 1, day: renewDay };
}

/**
 * Which reminder, if any, is due now. "soon" two or three days ahead, "tomorrow" the day before; nothing on the day
 * itself (it may already have been charged), nothing outside 9 am to 8 pm local. The caller keys each stage by
 * `renewsAt`, so running this every few minutes sends each stage at most once a renewal.
 */
export function subscriptionReminder(i: { renewDay: number | null; now: Date; timeZone: string }): SubscriptionReminder | null {
  const R = SUBSCRIPTION_REMINDER;
  if (i.renewDay === null) return null;
  const { hour } = localParts(i.now, i.timeZone);
  if (hour < R.fromHour || hour >= R.untilHour) return null;
  const date = nextRenewalDate(i.renewDay, i.now, i.timeZone);
  const days = daysBetween(localDate(i.now, i.timeZone), date);
  const stage: SubscriptionReminderStage | null = days === 1 ? "tomorrow" : days >= 2 && days <= R.soonDays ? "soon" : null;
  if (!stage) return null;
  return { stage, renewsAt: zonedInstant(date, R.renewMinuteLocal, i.timeZone) };
}
