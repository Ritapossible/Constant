/**
 * Shared vocabulary for the rule engine.
 *
 * Money is always an integer count of the currency's minor unit (kobo for NGN,
 * cents for ZAR/KES, pesewas for GHS) held in a bigint. Never a float, never a
 * number. The currency itself lives on the site's market, not in these types:
 * the rules compare amounts that are already known to be in the same currency.
 */

/** Integer minor units. `15_000_00n` is ₦15,000. */
export type Minor = bigint;

/** ISO weekday. 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export type SiteMode = "schedule" | "alert";

export type OrderTrigger = "schedule" | "low";

/** The weekly schedule an owner chose for one site. */
export interface Schedule {
  /** One or more ISO weekdays. */
  weekdays: readonly Weekday[];
  /** Minutes after local midnight. 420 = 07:00. */
  runMinuteLocal: number;
  /** IANA zone of the site's market, e.g. "Africa/Lagos". */
  timeZone: string;
}

export const DEFAULT_RUN_MINUTE_LOCAL = 7 * 60;
export const DEFAULT_MIN_HOURS_BETWEEN_BUYS = 20;
export const ALERT_COOLDOWN_HOURS = 6;

export function isWeekday(n: number): n is Weekday {
  return Number.isInteger(n) && n >= 1 && n <= 7;
}
