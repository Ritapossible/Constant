-- Tiered KYC (D-086) and idempotency keys on money-moving requests (D-087).

-- 0 basic (signed in), 1 verified (BVN checked by Paystack against the person's own bank account), 2 reviewed by a
-- person. The legal name is the one the BVN check confirmed; withdrawals go only to accounts in that name.
ALTER TABLE users ADD COLUMN kyc_tier smallint NOT NULL DEFAULT 0 CHECK (kyc_tier BETWEEN 0 AND 2);
ALTER TABLE users ADD COLUMN legal_first_name text;
ALTER TABLE users ADD COLUMN legal_last_name text;
-- Accounts that already hold an account number were issued it by Paystack before this existed: they keep tier 1
-- until a person reviews them (ops can lower a tier).
UPDATE users SET kyc_tier = 1 WHERE id IN (SELECT user_id FROM funding_accounts);

-- Each identity check. A BVN is never stored: only a keyed hash (so one BVN can verify one account) and its last 4.
CREATE TABLE kyc_checks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id),
  provider       text NOT NULL,
  -- bvn_bank_account: Paystack's customer validation; manual: a person raised or lowered the tier.
  kind           text NOT NULL CHECK (kind IN ('bvn_bank_account', 'manual')),
  status         text NOT NULL CHECK (status IN ('pending', 'verified', 'failed')),
  customer_code  text,
  bvn_hmac       text,
  bvn_last4      text,
  bank_code      text,
  account_last4  text,
  first_name     text,
  last_name      text,
  tier           smallint NOT NULL CHECK (tier BETWEEN 0 AND 2),
  reason         text,
  actor          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz
);
CREATE INDEX kyc_checks_by_user ON kyc_checks (user_id, created_at DESC);
CREATE INDEX kyc_checks_pending_by_customer ON kyc_checks (customer_code) WHERE status = 'pending';
CREATE UNIQUE INDEX kyc_checks_one_pending_per_user ON kyc_checks (user_id) WHERE status = 'pending';
-- One BVN verifies one ConstantUnits account.
CREATE UNIQUE INDEX kyc_checks_one_account_per_bvn ON kyc_checks (bvn_hmac) WHERE status = 'verified' AND bvn_hmac IS NOT NULL;

-- A money-moving request sent again with the same Idempotency-Key gets the first answer, never a second effect.
CREATE TABLE api_idempotency (
  user_id      uuid NOT NULL REFERENCES users(id),
  key          text NOT NULL,
  route        text NOT NULL,
  request_hash text NOT NULL,
  status_code  integer,
  response     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX api_idempotency_by_age ON api_idempotency (created_at);
