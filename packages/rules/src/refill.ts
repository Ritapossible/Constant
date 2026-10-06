/**
 * Refill decisions for sensed lines: data on the phone, and light (D-045 to D-048).
 *
 * These encode the field realities found in review:
 * - USSD often returns a menu or "you will get an SMS", not a balance. A failed
 *   or unparsed reply is never a low balance.
 * - Night, social and WhatsApp-only bundles are not the main balance.
 * - Some plans replace the active bundle instead of adding to it.
 * - The grid is often off, so light is used per supply hour, not per day.
 * - A spare token should not sit for weeks.
 */
import { HOUR_MS } from "./time.js";

const DAY_MS = 24 * HOUR_MS;

// ── Data ───────────────────────────────────────────────────────────────────

/** The last USSD reply that a network parser turned into the main data balance. */
export interface DataCalibration {
  /** Main data balance only. Night, social and app-only bundles are excluded by the parser. */
  mainDataMb: number;
  at: Date;
}

export interface DataRefillInput {
  autopilotOn: boolean;
  /** The user picked which SIM this line is. On dual-SIM phones we never guess. */
  simConfirmed: boolean;
  /**
   * Does the chosen plan add to an active bundle on this network? From the
   * stacking map (PLAN B7). null = not yet known, treated as "might replace".
   */
  planAddsToBalance: boolean | null;
  /** Last successful parse. Failed, menu or SMS-deferred replies never update this. */
  lastCalibration: DataCalibration | null;
  /** Mobile data used on that SIM since lastCalibration.at, from the phone's counter. */
  usedSinceCalibrationMb: number;
  thresholdMb: number;
  /** A calibration older than this is stale. Default 24h. */
  maxCalibrationAgeHours: number;
  /** Owner opted in to buying on the phone's count when the network check is stale. */
  buyOnEstimate: boolean;
  now: Date;
}

export type DataRefillDecision =
  | { kind: "buy"; basis: "measured" | "estimated"; estimateMb: number }
  | { kind: "ask"; reason: "autopilot_off" | "plan_may_replace" | "stale_calibration"; estimateMb: number }
  | { kind: "none"; reason: "sim_unconfirmed" | "no_calibration" | "above_line"; estimateMb?: number };

export function decideDataRefill(i: DataRefillInput): DataRefillDecision {
  if (!i.simConfirmed) return { kind: "none", reason: "sim_unconfirmed" };
  // Unknown is not low: without one good reading there is nothing to act on.
  if (i.lastCalibration === null) return { kind: "none", reason: "no_calibration" };

  const used = Math.max(0, i.usedSinceCalibrationMb);
  const estimateMb = Math.max(0, i.lastCalibration.mainDataMb - used);
  if (estimateMb > i.thresholdMb) return { kind: "none", reason: "above_line", estimateMb };

  if (!i.autopilotOn) return { kind: "ask", reason: "autopilot_off", estimateMb };
  if (i.planAddsToBalance !== true) return { kind: "ask", reason: "plan_may_replace", estimateMb };

  const ageMs = i.now.getTime() - i.lastCalibration.at.getTime();
  const fresh = ageMs >= 0 && ageMs <= i.maxCalibrationAgeHours * HOUR_MS;
  if (fresh) return { kind: "buy", basis: "measured", estimateMb };
  if (i.buyOnEstimate) return { kind: "buy", basis: "estimated", estimateMb };
  return { kind: "ask", reason: "stale_calibration", estimateMb };
}

// ── Light: how confident may we sound? ─────────────────────────────────────

/**
 * learning: say "still learning", show nothing.
 * rough: "about Thursday, from 2 readings", no percentage.
 * probability: the percentage may be shown.
 */
export type LightForecastMode = "learning" | "rough" | "probability";

export function lightForecastMode(readingCount: number, spanDays: number): LightForecastMode {
  if (readingCount < 2) return "learning";
  if (readingCount < 4 || spanDays < 7) return "rough";
  return "probability";
}

// ── Light: supply hours ────────────────────────────────────────────────────

/** NERC service bands and their minimum daily supply hours. A starting assumption, replaced by what the house reports. */
export const BAND_MIN_SUPPLY_HOURS: Readonly<Record<"A" | "B" | "C" | "D" | "E", number>> = {
  A: 20,
  B: 16,
  C: 12,
  D: 8,
  E: 4,
};

/** One-tap answer: "Was there light yesterday?" for morning, afternoon, night. Each period counts as 8 hours. */
export interface SupplyTap {
  morning: boolean;
  afternoon: boolean;
  night: boolean;
}

export function expectedSupplyHoursPerDay(
  band: keyof typeof BAND_MIN_SUPPLY_HOURS | null,
  recentTaps: readonly SupplyTap[],
): number {
  if (recentTaps.length > 0) {
    const periods = recentTaps.reduce((n, t) => n + Number(t.morning) + Number(t.afternoon) + Number(t.night), 0);
    return (periods * 8) / recentTaps.length;
  }
  return band ? BAND_MIN_SUPPLY_HOURS[band] : 12;
}

/**
 * Units used per hour of grid supply between two readings. Units do not fall
 * while the grid is off, so this is the rate that survives a bad supply week.
 * Units credited must come from vend receipts (after any debt deduction).
 */
export function unitsPerSupplyHour(unitsUsed: number, supplyHours: number): number | null {
  if (supplyHours <= 0 || unitsUsed < 0) return null;
  return unitsUsed / supplyHours;
}

/** Days of light left at the expected supply. null when nothing is being used. */
export function daysOfLightLeft(remainingUnits: number, perSupplyHour: number, supplyHoursPerDay: number): number | null {
  const perDay = perSupplyHour * supplyHoursPerDay;
  if (perDay <= 0) return null;
  return Math.max(0, remainingUnits) / perDay;
}

// ── Light: the spare token ─────────────────────────────────────────────────

export interface SpareTokenInput {
  spareEnabled: boolean;
  /** The outstanding spare, if any: bought but not yet confirmed keyed in. */
  outstanding: { boughtAt: Date } | null;
  /** Cautious days until run-out (e.g. from runOutWindow().early), or null if unknown. */
  earlyRunOutDays: number | null;
  now: Date;
  /** Buy the spare when the cautious run-out is this close. Default 3 days. */
  leadDays: number;
  /** A spare older than this gets a "please key it in" reminder. Default 14 days. */
  maxSpareAgeDays: number;
}

export type SpareTokenDecision =
  | { kind: "buy_spare" }
  | { kind: "remind_to_key"; ageDays: number }
  | { kind: "none"; reason: "disabled" | "spare_waiting" | "not_yet" | "unknown_runout" };

/**
 * One spare at a time. Never a second spare, and never a forecast buy while a
 * spare is waiting. Don't let a spare sit: old tokens can be rejected after key
 * changes, and a meter can refuse credit above its maximum.
 */
export function decideSpareToken(i: SpareTokenInput): SpareTokenDecision {
  if (!i.spareEnabled) return { kind: "none", reason: "disabled" };
  if (i.outstanding) {
    const ageDays = (i.now.getTime() - i.outstanding.boughtAt.getTime()) / DAY_MS;
    if (ageDays > i.maxSpareAgeDays) return { kind: "remind_to_key", ageDays };
    return { kind: "none", reason: "spare_waiting" };
  }
  if (i.earlyRunOutDays === null) return { kind: "none", reason: "unknown_runout" };
  if (i.earlyRunOutDays <= i.leadDays) return { kind: "buy_spare" };
  return { kind: "none", reason: "not_yet" };
}
