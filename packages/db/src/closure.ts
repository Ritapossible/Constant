/**
 * Closing an account (D-081). Erases what identifies the person and keeps the money record. Call it inside
 * withTx with the user locked, after checking there is no money left and nothing in flight (the API does).
 */
import type { Tx } from "./pool.js";

export interface ClosedAccount {
  /** The identity provider's id, so its account can be deleted too. */
  privyDid: string;
  /** The payment provider's customer behind the user's account number, for a person to deactivate. */
  fundingCustomerCode: string | null;
}

export async function closeAccount(tx: Tx, userId: string, now: Date): Promise<ClosedAccount> {
  const u = await tx.query<{ privy_did: string }>("SELECT privy_did FROM users WHERE id = $1", [userId]);
  if (!u.rows[0]) throw new Error("closeAccount: no such user");
  const funding = await tx.query<{ customer_code: string }>("SELECT customer_code FROM funding_accounts WHERE user_id = $1", [userId]);

  // Bills: stopped for good, payees erased. The rows stay because past orders point at them.
  await tx.query(
    `UPDATE lines SET status = 'cancelled', next_run_at = NULL, ref_ciphertext = 'erased', ref_hmac = 'erased:' || id::text,
       ref_last4 = '', customer_name = NULL, nickname = 'Closed', plan_name = NULL, updated_at = now()
     WHERE user_id = $1`,
    [userId],
  );
  await tx.query("DELETE FROM line_readings WHERE line_id IN (SELECT id FROM lines WHERE user_id = $1)", [userId]);
  // Stablecoin permissions: revoked; one already on chain is revoked there by the worker.
  await tx.query(
    `UPDATE spend_permissions SET status = CASE WHEN status = 'signed' THEN 'revoked' ELSE 'revoke_pending' END, tx_hash = NULL, tx_raw = NULL, updated_at = now()
     WHERE user_id = $1 AND status IN ('signed', 'approving', 'approved')`,
    [userId],
  );
  // Messages: nothing more is sent; sent ones keep no bill names.
  await tx.query("DELETE FROM notices WHERE user_id = $1 AND status = 'pending'", [userId]);
  await tx.query("UPDATE notices SET params = '{}' WHERE user_id = $1", [userId]);
  // Bank details, wallet addresses and the account number: removed. A transfer to the old account number then matches
  // no one and is held for a person to return (funding_unmatched), never credited to a closed account.
  await tx.query("DELETE FROM payout_accounts WHERE user_id = $1", [userId]);
  await tx.query("DELETE FROM user_addresses WHERE user_id = $1", [userId]);
  await tx.query("DELETE FROM funding_accounts WHERE user_id = $1", [userId]);
  await tx.query("UPDATE sessions SET revoked_at = $2, revoked_reason = 'all_signed_out' WHERE user_id = $1 AND revoked_at IS NULL", [userId, now]);
  await tx.query("UPDATE sessions SET user_agent = NULL WHERE user_id = $1", [userId]);
  // The person: no contact details, and the sign-in link is cut, so signing in again starts a new, empty account.
  await tx.query(
    `UPDATE users SET status = 'closed', closed_at = $2, email = NULL, phone_e164 = NULL, display_name = NULL,
       channels = '{}', telegram_chat_id = NULL, privy_did = 'closed:' || id::text, frozen_reason = NULL, updated_at = now()
     WHERE id = $1`,
    [userId, now],
  );
  return { privyDid: u.rows[0].privy_did, fundingCustomerCode: funding.rows[0]?.customer_code ?? null };
}
