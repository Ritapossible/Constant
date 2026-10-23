/**
 * Know-your-customer tiers and their limits (D-086). One source: the API enforces these, the app and the pricing
 * page show them. Modelled on the CBN's three-tier KYC framework; ConstantUnits is not a bank, but holding and
 * moving people's money calls for the same proportion between what we know about someone and how much moves.
 *
 *   Tier 0  signed in (email or phone). Card, USSD and QR top-ups, small; no account number, no withdrawals.
 *   Tier 1  BVN verified by Paystack against a bank account in the person's own name. The account number (Paystack
 *           issues it only to verified customers), withdrawals to that name.
 *   Tier 2  reviewed by a person (NIN, address). For larger households and small businesses.
 *
 * Bills are not limited here: they spend money already in the balance, which these limits bound, and each bill has
 * its own cap. Money arriving by bank transfer can't be refused; past a tier's limits it is credited and flagged
 * for a person (inboundOverLimit).
 */

export type KycTier = 0 | 1 | 2;

export interface TierLimits {
  name: string;
  /** Money in per rolling 24 hours (top-ups and transfers), kobo. */
  dailyInMinor: bigint;
  /** Largest balance, kobo. Null: no cap. */
  maxBalanceMinor: bigint | null;
  /** Withdrawals per rolling 24 hours, kobo. Zero: none. */
  dailyWithdrawMinor: bigint;
  /** A personal account number for bank transfers. */
  accountNumber: boolean;
}

export const KYC_TIERS: Record<KycTier, TierLimits> = {
  0: { name: "Basic", dailyInMinor: 5_000_000n, maxBalanceMinor: 30_000_000n, dailyWithdrawMinor: 0n, accountNumber: false },
  1: { name: "Verified", dailyInMinor: 20_000_000n, maxBalanceMinor: 50_000_000n, dailyWithdrawMinor: 20_000_000n, accountNumber: true },
  2: { name: "Reviewed", dailyInMinor: 500_000_000n, maxBalanceMinor: null, dailyWithdrawMinor: 500_000_000n, accountNumber: true },
};

export const KYC_MAX_TIER: KycTier = 2;

export function isKycTier(n: unknown): n is KycTier {
  return n === 0 || n === 1 || n === 2;
}

export type KycAction =
  | { kind: "topup"; amountMinor: bigint }
  | { kind: "withdraw"; amountMinor: bigint }
  | { kind: "account_number" };

export interface KycUsage {
  /** Credited in the last 24 hours (transfers and top-ups). */
  inLast24hMinor: bigint;
  /** Withdrawn or being withdrawn in the last 24 hours. */
  withdrawnLast24hMinor: bigint;
  balanceMinor: bigint;
}

export type KycDecision =
  | { kind: "allow" }
  | {
      kind: "refuse";
      reason: "verify_identity" | "daily_limit" | "balance_limit";
      /** The lowest tier that would allow this kind of action at all. */
      needTier: KycTier;
      /** How much would still be allowed today at the current tier (0 if none). */
      roomMinor: bigint;
    };

const max0 = (x: bigint) => (x > 0n ? x : 0n);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** The lowest tier whose limits could allow this action at all, ignoring today's usage. */
function lowestTierFor(a: KycAction): KycTier {
  for (const t of [0, 1, 2] as const) {
    const l = KYC_TIERS[t];
    if (a.kind === "account_number" && l.accountNumber) return t;
    if (a.kind === "withdraw" && a.amountMinor <= l.dailyWithdrawMinor) return t;
    if (a.kind === "topup" && a.amountMinor <= l.dailyInMinor && (l.maxBalanceMinor === null || a.amountMinor <= l.maxBalanceMinor)) return t;
  }
  return KYC_MAX_TIER;
}

/** Whether a person at `tier` may do this now. Never allows past a daily limit or the balance cap. */
export function decideKyc(tier: KycTier, a: KycAction, u: KycUsage): KycDecision {
  const l = KYC_TIERS[tier];
  const need = lowestTierFor(a);
  if (a.kind === "account_number") {
    return l.accountNumber ? { kind: "allow" } : { kind: "refuse", reason: "verify_identity", needTier: need, roomMinor: 0n };
  }
  if (a.amountMinor <= 0n) return { kind: "allow" };
  if (a.kind === "withdraw") {
    if (l.dailyWithdrawMinor === 0n) return { kind: "refuse", reason: "verify_identity", needTier: Math.max(need, 1) as KycTier, roomMinor: 0n };
    const room = max0(l.dailyWithdrawMinor - u.withdrawnLast24hMinor);
    return a.amountMinor <= room ? { kind: "allow" } : { kind: "refuse", reason: "daily_limit", needTier: need, roomMinor: room };
  }
  const dailyRoom = max0(l.dailyInMinor - u.inLast24hMinor);
  const balanceRoom = l.maxBalanceMinor === null ? null : max0(l.maxBalanceMinor - u.balanceMinor);
  if (balanceRoom !== null && a.amountMinor > balanceRoom && balanceRoom <= dailyRoom) {
    return { kind: "refuse", reason: "balance_limit", needTier: need > tier ? need : (Math.min(tier + 1, KYC_MAX_TIER) as KycTier), roomMinor: balanceRoom };
  }
  if (a.amountMinor > dailyRoom) {
    return { kind: "refuse", reason: "daily_limit", needTier: need, roomMinor: balanceRoom === null ? dailyRoom : min(dailyRoom, balanceRoom) };
  }
  return { kind: "allow" };
}

/**
 * Money that already arrived (a bank transfer can't be refused) and took the person past their tier's daily limit or
 * balance cap: it is credited, and a person reviews it (D-086). `u` is the usage before this credit.
 */
export function inboundOverLimit(tier: KycTier, amountMinor: bigint, u: KycUsage): boolean {
  const l = KYC_TIERS[tier];
  if (u.inLast24hMinor + amountMinor > l.dailyInMinor) return true;
  return l.maxBalanceMinor !== null && u.balanceMinor + amountMinor > l.maxBalanceMinor;
}

/** A Nigerian Bank Verification Number: 11 digits. */
export function isBvn(s: unknown): s is string {
  return typeof s === "string" && /^\d{11}$/.test(s);
}

/** A NUBAN bank account number: 10 digits. */
export function isNuban(s: unknown): s is string {
  return typeof s === "string" && /^\d{10}$/.test(s);
}
