/**
 * Running-low forecasts and reminders (D-042, D-043).
 *
 * "There's a 72% chance your data runs out before Friday." These are plain
 * statistics, never an LLM, and they never move money on their own: they
 * decide when to remind, and feed the refill rules as a labelled estimate.
 *
 * Usage values here are plain numbers in the line's own unit (MB, kWh). They
 * are not money. Money (wallet runway) stays in bigint minor units.
 */
import { localParts } from "./time.js";
import type { Minor } from "./types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface UsageStats {
  /** Average use per day. */
  meanPerDay: number;
  /** Day-to-day spread (sample standard deviation). */
  sdPerDay: number;
  /** Number of daily observations behind the estimate. */
  days: number;
}

/** Fewer days than this and we don't claim a probability; we say "still learning". */
export const MIN_HISTORY_DAYS = 3;

export function usageStats(dailyUsage: readonly number[]): UsageStats | null {
  const xs = dailyUsage.filter((x) => Number.isFinite(x) && x >= 0);
  if (xs.length < MIN_HISTORY_DAYS) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1);
  return { meanPerDay: mean, sdPerDay: Math.sqrt(variance), days: xs.length };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26; error < 1e-7). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Probability that usage over the next `horizonDays` exceeds `remaining`.
 * Treats days as independent with the observed mean and spread. Returns a
 * number in [0, 1].
 */
export function runOutProbability(remaining: number, stats: UsageStats, horizonDays: number): number {
  if (remaining <= 0) return 1;
  if (horizonDays <= 0) return 0;
  const mean = stats.meanPerDay * horizonDays;
  const sd = stats.sdPerDay * Math.sqrt(horizonDays);
  if (sd === 0) return mean >= remaining ? 1 : 0;
  return 1 - phi((remaining - mean) / sd);
}

/**
 * How many days until the chance of having run out reaches `p`.
 * p = 0.5 is the "likely" day; p = 0.2 is the early, cautious day we act on.
 * Returns null when it would take longer than `maxDays` (or usage is zero).
 */
export function daysUntilRunOut(remaining: number, stats: UsageStats, p: number, maxDays = 365): number | null {
  if (remaining <= 0) return 0;
  if (runOutProbability(remaining, stats, maxDays) < p) return null;
  let lo = 0;
  let hi = maxDays;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (runOutProbability(remaining, stats, mid) >= p) hi = mid;
    else lo = mid;
  }
  return hi;
}

export interface RunOutWindow {
  /** 20% chance of having run out by then: the cautious date. */
  early: Date;
  /** 50%: the date we show as "likely". */
  likely: Date;
}

export function runOutWindow(remaining: number, stats: UsageStats, now: Date): RunOutWindow | null {
  const early = daysUntilRunOut(remaining, stats, 0.2);
  const likely = daysUntilRunOut(remaining, stats, 0.5);
  if (early === null || likely === null) return null;
  return {
    early: new Date(now.getTime() + early * DAY_MS),
    likely: new Date(now.getTime() + likely * DAY_MS),
  };
}

// ── Reminders ──────────────────────────────────────────────────────────────

export interface ReminderPolicy {
  /** Remind when the chance of running out within the horizon reaches this. Default 0.6. */
  probabilityAtLeast: number;
  /** How far ahead to look. Default 48h. */
  horizonHours: number;
  /** At most one reminder per line in this window. Default 24h. */
  cooldownHours: number;
  /** No reminders between these local minutes (e.g. 22:00 → 07:00). */
  quietStartMinuteLocal: number;
  quietEndMinuteLocal: number;
  timeZone: string;
}

export const DEFAULT_REMINDER_POLICY: Omit<ReminderPolicy, "timeZone"> = {
  probabilityAtLeast: 0.6,
  horizonHours: 48,
  cooldownHours: 24,
  quietStartMinuteLocal: 22 * 60,
  quietEndMinuteLocal: 7 * 60,
};

export interface LowReminderInput {
  /** Latest remaining amount for the line, in its unit. */
  remaining: number;
  stats: UsageStats | null;
  /** True when autopilot is on for this line and the wallet covers the next refill. */
  coveredByAutopilot: boolean;
  lastReminderAt: Date | null;
  now: Date;
  policy: ReminderPolicy;
}

export type LowReminderDecision =
  | {
      kind: "remind";
      /** heads_up: "likely low by Thu, Constant will top up". act: the user must do something. */
      tone: "heads_up" | "act";
      probability: number;
    }
  | { kind: "none"; reason: "learning" | "unlikely" | "cooldown" | "quiet_hours" };

function inQuietHours(now: Date, p: ReminderPolicy): boolean {
  const { hour, minute } = localParts(now, p.timeZone);
  const m = hour * 60 + minute;
  const { quietStartMinuteLocal: s, quietEndMinuteLocal: e } = p;
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

export function decideLowReminder(i: LowReminderInput): LowReminderDecision {
  if (i.stats === null) return { kind: "none", reason: "learning" };
  const probability = runOutProbability(i.remaining, i.stats, i.policy.horizonHours / 24);
  if (probability < i.policy.probabilityAtLeast) return { kind: "none", reason: "unlikely" };
  if (i.lastReminderAt && i.now.getTime() - i.lastReminderAt.getTime() < i.policy.cooldownHours * HOUR_MS) {
    return { kind: "none", reason: "cooldown" };
  }
  if (inQuietHours(i.now, i.policy)) return { kind: "none", reason: "quiet_hours" };
  return { kind: "remind", tone: i.coveredByAutopilot ? "heads_up" : "act", probability };
}

// ── Wallet runway ──────────────────────────────────────────────────────────

export interface UpcomingCharge {
  lineId: string;
  /** When we expect to pay: a renewal date (cable, subscriptions) or a forecast refill date. */
  at: Date;
  amountMinor: Minor;
  /** Renewals are certain; forecast refills are estimates and are labelled so. */
  certainty: "scheduled" | "estimated";
}

export type Runway =
  | { kind: "covered"; through: Date | null }
  | { kind: "short"; firstUncovered: UpcomingCharge; shortfallMinor: Minor; coveredThrough: Date | null };

/**
 * Walk upcoming charges in date order against the money set aside. Tells the
 * user before payday which renewal would fail and by how much, instead of on
 * the morning it fails.
 */
export function walletRunway(availableMinor: Minor, charges: readonly UpcomingCharge[]): Runway {
  const sorted = [...charges].sort((a, b) => a.at.getTime() - b.at.getTime());
  let left = availableMinor;
  let through: Date | null = null;
  for (const c of sorted) {
    if (c.amountMinor > left) {
      return { kind: "short", firstUncovered: c, shortfallMinor: c.amountMinor - left, coveredThrough: through };
    }
    left -= c.amountMinor;
    through = c.at;
  }
  return { kind: "covered", through };
}
