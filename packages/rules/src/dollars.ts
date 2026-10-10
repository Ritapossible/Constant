/**
 * Paying a naira bill from the user's USDC on Base (RAILS "How an automatic payment works", D-063).
 *
 * The user signs a spend permission: Constant may take up to `allowance` USDC per `period` from their own
 * smart account. When a bill is due, the charge is computed here from the naira price and a fresh rate,
 * and must fit inside what the permission has left this period and what the account holds. Nothing else
 * may compute a dollar charge.
 *
 * Units: naira in kobo, USDC in micro-units (6 decimals), the rate in kobo per 1 USDC. All bigint.
 */
import { decideRenewal, type RenewalInput, type RenewalSkipReason } from "./renewal.js";
import type { Minor } from "./types.js";

export const USDC_UNIT = 1_000_000n;
/** 30 days: one permission period per monthly bill. */
export const PERMISSION_PERIOD_SECONDS = 30 * 24 * 60 * 60;
/** A permission runs for a year, then the user re-confirms. */
export const PERMISSION_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
/** Headroom over the limit so normal naira moves don't stop the bill: 8%. The user sees the dollar figure. */
export const DEFAULT_FX_BUFFER_BPS = 800n;
/** A rate older than this is not used to charge anyone. */
export const MAX_RATE_AGE_MS = 10 * 60 * 1000;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** USDC needed to cover `nairaMinor`, rounded up to the micro-unit, so Constant is never short. */
export function usdcForNaira(nairaMinor: Minor, koboPerUsdc: bigint): bigint {
  if (koboPerUsdc <= 0n) throw new Error("rate must be positive");
  if (nairaMinor < 0n) throw new Error("amount must be >= 0");
  return ceilDiv(nairaMinor * USDC_UNIT, koboPerUsdc);
}

/** "1352.34" naira per USDC → 135234 kobo per USDC. Exact; rejects anything that isn't a plain positive decimal. */
export function parseRate(ngnPerUsdc: string): bigint {
  const m = /^(\d{1,9})(?:\.(\d{1,2})\d*)?$/.exec(ngnPerUsdc.trim());
  if (!m) throw new Error(`bad rate: ${ngnPerUsdc}`);
  const kobo = BigInt(m[1]!) * 100n + BigInt((m[2] ?? "0").padEnd(2, "0"));
  if (kobo <= 0n) throw new Error("rate must be positive");
  return kobo;
}

/**
 * The per-period allowance to ask the user to sign for a bill with a naira limit: the limit at today's rate
 * plus a buffer, rounded up to the cent. A forecast never raises it; only the user can (INV-29).
 */
export function permissionAllowance(capMinor: Minor, koboPerUsdc: bigint, bufferBps: bigint = DEFAULT_FX_BUFFER_BPS): bigint {
  if (capMinor <= 0n) throw new Error("cap must be positive");
  const base = usdcForNaira(capMinor, koboPerUsdc);
  const withBuffer = ceilDiv(base * (10_000n + bufferBps), 10_000n);
  return ceilDiv(withBuffer, 10_000n) * 10_000n; // whole cents
}

export interface DollarPermissionState {
  /** approved = registered on chain and usable; anything else can't be charged. */
  status: "signed" | "approving" | "approved" | "revoke_pending" | "revoked" | "failed";
  /** USDC micro-units still available in the current period, read from the chain. */
  remainingThisPeriod: bigint;
  /** Unix seconds; the permission can't be used at or after this. */
  endsAt: number;
}

export interface DollarRenewalInput extends Omit<RenewalInput, "availableMinor"> {
  permission: DollarPermissionState | null;
  rate: { koboPerUsdc: bigint; fetchedAt: Date } | null;
  /** USDC micro-units in the user's smart account, read from the chain. */
  walletMicro: bigint;
}

export type DollarSkipReason = RenewalSkipReason | "no_permission" | "permission_expired" | "rate_stale" | "allowance_used" | "wallet_short";

export type DollarRenewalDecision =
  | { kind: "charge"; amountMinor: Minor; feeMinor: Minor; usdcMicro: bigint; koboPerUsdc: bigint }
  | { kind: "do_not_renew"; reason: DollarSkipReason; usdcMicro?: bigint };

/**
 * Same rules as a naira renewal (safety, state, timing, price, the user's naira limit), then the dollar
 * checks in order: a usable permission, a fresh rate, room in this period, money in the account.
 */
export function decideDollarRenewal(i: DollarRenewalInput): DollarRenewalDecision {
  // Money is checked in dollars below, so the naira balance check is satisfied by construction here.
  const naira = decideRenewal({ ...i, availableMinor: 2n ** 62n });
  if (naira.kind === "do_not_renew") return naira;

  const p = i.permission;
  if (!p || p.status !== "approved") return { kind: "do_not_renew", reason: "no_permission" };
  if (Math.floor(i.now.getTime() / 1000) >= p.endsAt) return { kind: "do_not_renew", reason: "permission_expired" };
  if (!i.rate || i.now.getTime() - i.rate.fetchedAt.getTime() > MAX_RATE_AGE_MS || i.rate.koboPerUsdc <= 0n) {
    return { kind: "do_not_renew", reason: "rate_stale" };
  }
  const usdcMicro = usdcForNaira(naira.amountMinor + naira.feeMinor, i.rate.koboPerUsdc);
  if (usdcMicro > p.remainingThisPeriod) return { kind: "do_not_renew", reason: "allowance_used", usdcMicro };
  if (usdcMicro > i.walletMicro) return { kind: "do_not_renew", reason: "wallet_short", usdcMicro };
  return { kind: "charge", amountMinor: naira.amountMinor, feeMinor: naira.feeMinor, usdcMicro, koboPerUsdc: i.rate.koboPerUsdc };
}

// ── Guards before taking anyone's dollars (from review, 2026-10-10) ─────────────

export type Screening = "clear" | "pending" | "flagged" | "unscreened";

export interface ChargeGuardInput {
  /** system_flags.dollar_charges_enabled: off after the daily limit trips or by a person. */
  dollarChargesEnabled: boolean;
  /** USDC (micro) charged across all users in the last 24 hours, including submitted charges. */
  spent24hMicro: bigint;
  valueMicro: bigint;
  /** Most Constant's spender may take in 24 hours, all users together: caps the damage of a stolen key. */
  dailyLimitMicro: bigint;
  /** Naira at the vend partner right now, and what this order needs plus a margin for orders in flight. */
  floatMinor: bigint | null;
  needMinor: bigint;
  floatMarginMinor: bigint;
  /** Sanctions screening of every address that sent this account USDC, and of the account itself. */
  screening: Screening;
  screeningRequired: boolean;
}

export type ChargeGuard =
  | { kind: "ok" }
  | { kind: "hold"; reason: "float_low" | "float_unknown" | "screening_pending" }
  | { kind: "stop_all"; reason: "dollar_off" | "daily_limit" }
  | { kind: "refuse"; reason: "screening_flagged" | "unscreened" };

/**
 * Checked immediately before a USDC charge is signed. Order: global safety, then the person, then the float.
 * - A tripped daily limit stops every dollar charge until a person looks (stop_all).
 * - A flagged address refuses the charge and freezes the user; unscreened is refused when screening is required.
 * - USDC is never taken if the naira to pay the bill isn't there: no float, no charge (hold and page).
 */
export function decideChargeGuard(i: ChargeGuardInput): ChargeGuard {
  if (!i.dollarChargesEnabled) return { kind: "stop_all", reason: "dollar_off" };
  if (i.valueMicro <= 0n || i.spent24hMicro + i.valueMicro > i.dailyLimitMicro) return { kind: "stop_all", reason: "daily_limit" };
  if (i.screening === "flagged") return { kind: "refuse", reason: "screening_flagged" };
  if (i.screening === "pending") return { kind: "hold", reason: "screening_pending" };
  if (i.screening === "unscreened" && i.screeningRequired) return { kind: "refuse", reason: "unscreened" };
  if (i.floatMinor === null) return { kind: "hold", reason: "float_unknown" };
  if (i.floatMinor < i.needMinor + i.floatMarginMinor) return { kind: "hold", reason: "float_low" };
  return { kind: "ok" };
}

// ── Refilling the naira float from charged USDC (D-068) ──────────────────────────

export interface FloatRefillInput {
  /** Naira at the vend partner now (null: couldn't read it). */
  floatMinor: bigint | null;
  /** Refill when the float drops below this… */
  lowWaterMinor: bigint;
  /** …back up to about this. */
  targetMinor: bigint;
  /** USDC (micro) on the spender, i.e. charged and not yet swept. */
  spenderMicro: bigint;
  /** Smallest off-ramp worth its fees. */
  minOrderMicro: bigint;
  koboPerUsdc: bigint | null;
  offrampInFlight: boolean;
}

export type FloatRefill =
  | { kind: "refill"; usdcMicro: bigint }
  | { kind: "none"; reason: "in_flight" | "float_unknown" | "float_ok" | "no_rate" | "too_small" };

/** Never more USDC than the spender holds, never more than the target needs, never below the minimum. */
export function decideFloatRefill(i: FloatRefillInput): FloatRefill {
  if (i.offrampInFlight) return { kind: "none", reason: "in_flight" };
  if (i.floatMinor === null) return { kind: "none", reason: "float_unknown" };
  if (i.floatMinor >= i.lowWaterMinor) return { kind: "none", reason: "float_ok" };
  if (!i.koboPerUsdc || i.koboPerUsdc <= 0n) return { kind: "none", reason: "no_rate" };
  const needed = usdcForNaira(i.targetMinor - i.floatMinor, i.koboPerUsdc);
  const send = (needed < i.spenderMicro ? needed : i.spenderMicro) / 10_000n * 10_000n; // whole cents
  if (send < i.minOrderMicro || send <= 0n) return { kind: "none", reason: "too_small" };
  return { kind: "refill", usdcMicro: send };
}
