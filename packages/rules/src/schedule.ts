/**
 * decideSchedule: the single function that says buy or do-not-buy.
 *
 * Both the minute-by-minute schedule scan and a LOW text call this. Nothing
 * else in the codebase may compute a buy amount or approve a vend.
 */
import { hoursBetween, sameLocalDate } from "./time.js";
import type { Minor, OrderTrigger, SiteMode, Weekday } from "./types.js";

export interface ScheduleDecisionInput {
  trigger: OrderTrigger;
  mode: SiteMode;
  verified: boolean;
  frozen: boolean;
  /** Global kill switch. False after any reconciliation mismatch. */
  vendingEnabled: boolean;

  /** Ledger sum for this site. Never a cached value that was not written in the same transaction. */
  balanceMinor: Minor;
  /** The fixed amount the owner chose. Null means the site is not fully onboarded. */
  buyAmountMinor: Minor | null;
  /**
   * Vends this week (since local Monday 00:00), counting every order that is not
   * `failed`: accepted, pending and in flight included.
   */
  weeklySpentMinor: Minor;
  /** Use effectiveWeeklyCap() so a null column gets the documented default. */
  weeklyCapMinor: Minor;
  /** Most recent buy: the later of the last settled buy and any open order's creation time. */
  lastBuyAt: Date | null;
  minHoursBetweenBuys: number;
  /**
   * True when any order for this site is in ready / vending / token_stored /
   * notifying / needs_human. One open order per site at a time; this is what
   * stops a LOW and the scheduler from both spending the same balance while the
   * first vend is still with the partner.
   */
  hasOpenOrder: boolean;
  now: Date;

  /** Schedule trigger only: the next_run_at being served. */
  scheduledFor?: Date | null;
  /** Schedule trigger only: scheduledFor is in the skips table. */
  skipped?: boolean;
  /** Schedule trigger only: the site's zone, to tell a late run from a missed one. */
  timeZone?: string;
}

export type DoNotBuyReason =
  | "killed"
  | "not_schedule"
  | "misconfigured"
  | "unverified"
  | "frozen"
  | "not_due"
  | "stale"
  | "skipped"
  | "in_flight"
  | "too_soon"
  | "weekly_cap"
  | "insufficient";

export type ScheduleDecision =
  | { kind: "buy"; amountMinor: Minor }
  | { kind: "do_not_buy"; reason: DoNotBuyReason };

const no = (reason: DoNotBuyReason): ScheduleDecision => ({ kind: "do_not_buy", reason });

/**
 * Order of checks is part of the contract: the first failing reason is the one
 * the owner hears about. Safety (kill switch, freeze) before configuration,
 * configuration before timing, timing before money.
 */
export function decideSchedule(i: ScheduleDecisionInput): ScheduleDecision {
  if (!i.vendingEnabled) return no("killed");
  if (i.mode !== "schedule") return no("not_schedule");
  if (i.buyAmountMinor === null || i.buyAmountMinor <= 0n) return no("misconfigured");
  if (!i.verified) return no("unverified");
  if (i.frozen) return no("frozen");

  if (i.trigger === "schedule") {
    const due = i.scheduledFor ?? null;
    if (due === null || due.getTime() > i.now.getTime()) return no("not_due");
    if (!i.timeZone) return no("misconfigured");
    // A run is served on its own local day or not at all. No catch-up buys.
    if (!sameLocalDate(due, i.now, i.timeZone)) return no("stale");
    if (i.skipped) return no("skipped");
  }

  if (i.hasOpenOrder) return no("in_flight");
  if (i.lastBuyAt !== null && hoursBetween(i.lastBuyAt, i.now) < i.minHoursBetweenBuys) {
    return no("too_soon");
  }
  if (i.weeklySpentMinor + i.buyAmountMinor > i.weeklyCapMinor) return no("weekly_cap");
  if (i.balanceMinor < i.buyAmountMinor) return no("insufficient");

  return { kind: "buy", amountMinor: i.buyAmountMinor };
}

/** Default weekly cap: buy amount times the number of chosen days. */
export function effectiveWeeklyCap(
  weeklyCapMinor: Minor | null,
  buyAmountMinor: Minor,
  weekdays: readonly Weekday[],
): Minor {
  if (weeklyCapMinor !== null) return weeklyCapMinor;
  return buyAmountMinor * BigInt(new Set(weekdays).size);
}

/**
 * What the schedule scan does with a due site after deciding.
 *
 * - vend: insert the order and advance next_run_at in one transaction, then enqueue.
 * - advance: move next_run_at to the next slot, send nothing.
 * - advance_and_notify: move next_run_at and tell the owner once, keyed by
 *   (site, scheduledFor) so a crash-and-retry cannot send it twice.
 * - hold: leave next_run_at alone and try again next minute. Only for states
 *   that clear themselves or need a human (kill switch, open order).
 */
export type ScanAction =
  | { kind: "vend"; amountMinor: Minor }
  | { kind: "advance" }
  | { kind: "advance_and_notify"; notice: "insufficient" | "weekly_cap" | "missed" }
  | { kind: "hold" };

export function scanAction(d: ScheduleDecision): ScanAction {
  if (d.kind === "buy") return { kind: "vend", amountMinor: d.amountMinor };
  switch (d.reason) {
    case "insufficient":
      return { kind: "advance_and_notify", notice: "insufficient" };
    case "weekly_cap":
      return { kind: "advance_and_notify", notice: "weekly_cap" };
    case "stale":
      return { kind: "advance_and_notify", notice: "missed" };
    case "skipped":
    case "too_soon":
      return { kind: "advance" };
    case "killed":
    case "in_flight":
    case "not_due":
    case "not_schedule":
    case "misconfigured":
    case "unverified":
    case "frozen":
      return { kind: "hold" };
  }
}
