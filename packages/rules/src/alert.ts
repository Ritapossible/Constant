/**
 * Alert-only mode. Never buys. Invariants 16-18.
 */
import { ALERT_COOLDOWN_HOURS, type SiteMode } from "./types.js";
import { hoursBetween } from "./time.js";

export type ParsedUnits = { ok: true; units: number } | { ok: false };

// "18", "18.5", "18,5", "18 units", "18unit", "18 kwh". One number only.
const UNITS_PATTERN = /^(\d{1,6})(?:[.,](\d+))?\s*(?:units?|kwh)?\.?$/i;

/**
 * Parse a unit reading typed by a person at the premises.
 *
 * Rejects anything with more than six integer digits. That covers the spec's
 * 11-13 digit rule (someone pasting the meter or phone number) and also
 * 20-digit tokens, which must never be read as a unit count.
 */
export function parseUnits(raw: string): ParsedUnits {
  const text = raw.trim();
  const m = UNITS_PATTERN.exec(text);
  if (!m || m[1] === undefined) return { ok: false };
  return { ok: true, units: Number.parseInt(m[1], 10) };
}

export interface AlertDecisionInput {
  mode: SiteMode;
  rawText: string;
  thresholdUnits: number | null;
  lastAlertAt: Date | null;
  now: Date;
}

export type AlertIgnoreReason = "not_alert" | "not_a_number" | "not_low" | "too_soon";

export type AlertDecision =
  | { kind: "alert"; units: number }
  | { kind: "ignore"; reason: AlertIgnoreReason; units?: number };

/**
 * Whether a unit reading from the site phone should reach the owner.
 * The site phone is acknowledged in every case except not_a_number, which gets
 * a prompt to send a number.
 */
export function decideAlert(i: AlertDecisionInput): AlertDecision {
  if (i.mode !== "alert" || i.thresholdUnits === null) return { kind: "ignore", reason: "not_alert" };
  const parsed = parseUnits(i.rawText);
  if (!parsed.ok) return { kind: "ignore", reason: "not_a_number" };
  if (parsed.units > i.thresholdUnits) return { kind: "ignore", reason: "not_low", units: parsed.units };
  if (i.lastAlertAt !== null && hoursBetween(i.lastAlertAt, i.now) < ALERT_COOLDOWN_HOURS) {
    return { kind: "ignore", reason: "too_soon", units: parsed.units };
  }
  return { kind: "alert", units: parsed.units };
}
