/**
 * decideRenewal: buy or do-not-buy for a line that renews on a date (cable TV, D-041).
 *
 * The renewal scan calls this for every line whose next_run_at is due. Nothing else
 * may approve a renewal or compute its amount. The amount always comes from a fresh,
 * side-effect-free quote from the partner (decoder lookup), never from the client.
 */
import { DAY_MS, addDays, localDate, zonedInstant } from "./time.js";
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
  | { kind: "notify_and_hold"; notice: "insufficient" | "above_cap" }
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
 * Money a user can spend now. Open orders have not written their ledger entries yet
 * (that happens on delivery), so their amount and fee are held back here. Without
 * this, two lines due on the same morning could both spend the same naira.
 */
export function availableBalance(ledgerSumMinor: Minor, committedToOpenOrdersMinor: Minor): Minor {
  if (committedToOpenOrdersMinor < 0n) throw new Error("availableBalance: committed must be >= 0");
  return ledgerSumMinor - committedToOpenOrdersMinor;
}
