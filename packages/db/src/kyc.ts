/** Repositories for KYC tiers and identity checks (D-086), and idempotent requests (D-087). */
import type { KycTier, KycUsage } from "@constant/rules";
import type { Q, Tx } from "./pool.js";

export class BvnInUse extends Error {}

export interface KycCheckRow {
  id: string;
  user_id: string;
  provider: string;
  kind: "bvn_bank_account" | "manual";
  status: "pending" | "verified" | "failed";
  customer_code: string | null;
  bvn_hmac: string | null;
  bvn_last4: string | null;
  bank_code: string | null;
  account_last4: string | null;
  first_name: string | null;
  last_name: string | null;
  tier: number;
  reason: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export async function kycTierOf(q: Q, userId: string): Promise<KycTier> {
  const r = await q.query<{ kyc_tier: number }>("SELECT kyc_tier FROM users WHERE id = $1", [userId]);
  return (r.rows[0]?.kyc_tier ?? 0) as KycTier;
}

export async function latestKycCheck(q: Q, userId: string): Promise<KycCheckRow | null> {
  const r = await q.query<KycCheckRow>("SELECT * FROM kyc_checks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [userId]);
  return r.rows[0] ?? null;
}

/** The Paystack customer this user was verified (or is being verified) as, if any. */
export async function kycCustomerCode(q: Q, userId: string): Promise<string | null> {
  const r = await q.query<{ customer_code: string }>(
    "SELECT customer_code FROM kyc_checks WHERE user_id = $1 AND customer_code IS NOT NULL AND status IN ('verified','pending') ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  return r.rows[0]?.customer_code ?? null;
}

/** True if this BVN already verified a different account. */
export async function bvnVerifiedElsewhere(q: Q, bvnHmac: string, userId: string): Promise<boolean> {
  const r = await q.query("SELECT 1 FROM kyc_checks WHERE bvn_hmac = $1 AND status = 'verified' AND user_id <> $2", [bvnHmac, userId]);
  return (r.rowCount ?? 0) > 0;
}

export async function startKycCheck(
  q: Q,
  c: { userId: string; provider: string; customerCode: string; bvnHmac: string; bvnLast4: string; bankCode: string; accountLast4: string; firstName: string; lastName: string },
): Promise<KycCheckRow> {
  const r = await q.query<KycCheckRow>(
    `INSERT INTO kyc_checks (user_id, provider, kind, status, customer_code, bvn_hmac, bvn_last4, bank_code, account_last4, first_name, last_name, tier)
     VALUES ($1,$2,'bvn_bank_account','pending',$3,$4,$5,$6,$7,$8,$9,1) RETURNING *`,
    [c.userId, c.provider, c.customerCode, c.bvnHmac, c.bvnLast4, c.bankCode, c.accountLast4, c.firstName, c.lastName],
  );
  return r.rows[0]!;
}

/** Drops a pending check that never reached the provider (the call failed), so the person can try again. */
export async function abandonKycCheck(q: Q, id: string, reason: string): Promise<void> {
  await q.query("UPDATE kyc_checks SET status = 'failed', reason = $2, decided_at = now() WHERE id = $1 AND status = 'pending'", [id, reason]);
}

export async function lockPendingKycByCustomer(tx: Tx, customerCode: string): Promise<KycCheckRow | null> {
  const r = await tx.query<KycCheckRow>("SELECT * FROM kyc_checks WHERE customer_code = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [customerCode]);
  return r.rows[0] ?? null;
}

/**
 * Records the provider's answer. Verified: the user's tier rises to the check's tier (never lowers) and their legal
 * name is set. Refuses (BvnInUse) if the same BVN verified another account in the meantime.
 */
export async function decideKycCheck(tx: Tx, check: KycCheckRow, outcome: { verified: boolean; reason?: string | null }, now: Date): Promise<void> {
  if (outcome.verified && check.bvn_hmac && (await bvnVerifiedElsewhere(tx, check.bvn_hmac, check.user_id))) {
    await tx.query("UPDATE kyc_checks SET status = 'failed', reason = 'bvn_in_use', decided_at = $2 WHERE id = $1", [check.id, now]);
    throw new BvnInUse("this BVN already verified another account");
  }
  await tx.query("UPDATE kyc_checks SET status = $2, reason = $3, decided_at = $4 WHERE id = $1", [check.id, outcome.verified ? "verified" : "failed", outcome.reason ?? null, now]);
  if (outcome.verified) {
    await tx.query(
      "UPDATE users SET kyc_tier = GREATEST(kyc_tier, $2), legal_first_name = $3, legal_last_name = $4, updated_at = now() WHERE id = $1",
      [check.user_id, check.tier, check.first_name, check.last_name],
    );
  }
}

/** A person sets the tier (up for a review, down after one). Recorded as a check with who and why. */
export async function setKycTierManually(tx: Tx, userId: string, tier: KycTier, actor: string, reason: string): Promise<void> {
  await tx.query("INSERT INTO kyc_checks (user_id, provider, kind, status, tier, reason, actor, decided_at) VALUES ($1,'ops','manual','verified',$2,$3,$4,now())", [userId, tier, reason, actor]);
  await tx.query("UPDATE users SET kyc_tier = $2, updated_at = now() WHERE id = $1", [userId, tier]);
}

/**
 * Money in and out over the last 24 hours, and the balance: what the tier limits are checked against. The window is
 * measured on the database's clock, the same clock that stamped the rows it sums.
 */
export async function kycUsage(q: Q, userId: string): Promise<KycUsage> {
  const r = await q.query<{ inbound: string; withdrawn: string; balance: string }>(
    `SELECT
       (COALESCE((SELECT SUM(amount_minor) FROM funding_events WHERE user_id = $1 AND status = 'credited' AND received_at > now() - interval '24 hours'), 0)
        + COALESCE((SELECT SUM(credit_minor) FROM topups WHERE user_id = $1 AND status = 'credited' AND created_at > now() - interval '24 hours'), 0))::text AS inbound,
       COALESCE((SELECT SUM(amount_minor) FROM withdrawals WHERE user_id = $1 AND status NOT IN ('failed','reversed') AND created_at > now() - interval '24 hours'), 0)::text AS withdrawn,
       COALESCE((SELECT SUM(amount_minor) FROM ledger_entries WHERE user_id = $1), 0)::text AS balance`,
    [userId],
  );
  const row = r.rows[0]!;
  return { inLast24hMinor: BigInt(row.inbound), withdrawnLast24hMinor: BigInt(row.withdrawn), balanceMinor: BigInt(row.balance) };
}

// ── Idempotency keys (D-087) ────────────────────────────────────────────────────

export interface IdempotentRecord {
  route: string;
  request_hash: string;
  status_code: number | null;
  response: string | null;
}

/**
 * Claims a key for this request. Returns null when the claim is new (go ahead), or the earlier record when the key
 * was used before (replay it, or refuse if it was for a different request). Keys older than a day are forgotten.
 */
export async function claimIdempotencyKey(q: Q, userId: string, key: string, route: string, requestHash: string, now: Date): Promise<IdempotentRecord | null> {
  await q.query("DELETE FROM api_idempotency WHERE user_id = $1 AND key = $2 AND created_at < $3::timestamptz - interval '24 hours'", [userId, key, now]);
  const ins = await q.query("INSERT INTO api_idempotency (user_id, key, route, request_hash, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [userId, key, route, requestHash, now]);
  if ((ins.rowCount ?? 0) === 1) return null;
  const r = await q.query<IdempotentRecord>("SELECT route, request_hash, status_code, response FROM api_idempotency WHERE user_id = $1 AND key = $2", [userId, key]);
  return r.rows[0] ?? null;
}

export async function completeIdempotencyKey(q: Q, userId: string, key: string, statusCode: number, response: string): Promise<void> {
  await q.query("UPDATE api_idempotency SET status_code = $3, response = $4 WHERE user_id = $1 AND key = $2", [userId, key, statusCode, response]);
}

/** A server error leaves nothing done: the same key may be tried again. */
export async function releaseIdempotencyKey(q: Q, userId: string, key: string): Promise<void> {
  await q.query("DELETE FROM api_idempotency WHERE user_id = $1 AND key = $2 AND status_code IS NULL", [userId, key]);
}
