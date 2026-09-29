import type { ScheduleDecisionInput } from "../src/index.js";

export const LAGOS = "Africa/Lagos";

/** ₦ in kobo. naira(15_000) === 1_500_000n */
export const naira = (n: number): bigint => BigInt(n) * 100n;

/** 2026-10-05 is a Monday. 07:00 Lagos is 06:00Z. */
export const MON_0700 = new Date("2026-10-05T06:00:00Z");

export const hoursAfter = (d: Date, h: number): Date => new Date(d.getTime() + h * 3_600_000);

/** A schedule site that should buy: due now, funded, verified, active. */
export function dueSite(over: Partial<ScheduleDecisionInput> = {}): ScheduleDecisionInput {
  return {
    trigger: "schedule",
    mode: "schedule",
    verified: true,
    frozen: false,
    vendingEnabled: true,
    balanceMinor: naira(50_000),
    buyAmountMinor: naira(15_000),
    weeklySpentMinor: 0n,
    weeklyCapMinor: naira(15_000),
    lastBuyAt: null,
    minHoursBetweenBuys: 20,
    hasOpenOrder: false,
    now: MON_0700,
    scheduledFor: MON_0700,
    skipped: false,
    timeZone: LAGOS,
    ...over,
  };
}

export function lowRequest(over: Partial<ScheduleDecisionInput> = {}): ScheduleDecisionInput {
  const { scheduledFor: _s, skipped: _k, ...rest } = dueSite({ trigger: "low", ...over });
  return rest;
}
