-- Operations, reconciliation, naira withdrawals and the Paycrest off-ramp (D-065 to D-068).

-- Alerts are emailed to the ops inbox once.
ALTER TABLE ops_alerts ADD COLUMN notified_at timestamptz;

-- Every ops action, with who did it. Nothing an operator does is unrecorded.
CREATE TABLE ops_actions (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  target     text,
  detail     jsonb NOT NULL DEFAULT '{}',
  at         timestamptz NOT NULL DEFAULT now()
);

-- Reconciliation runs and what they found.
CREATE TABLE reconciliation_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean,
  checked     jsonb NOT NULL DEFAULT '{}',
  mismatches  jsonb NOT NULL DEFAULT '[]',
  actor       text NOT NULL
);

-- Naira withdrawals to the user's own, name-verified bank account (D-040, D-050).
CREATE TABLE payout_accounts (
  user_id        uuid PRIMARY KEY REFERENCES users(id),
  provider       text NOT NULL,
  bank_code      text NOT NULL,
  bank_name      text NOT NULL,
  account_last4  text NOT NULL,
  account_name   text NOT NULL,
  recipient_code text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE withdrawals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      text NOT NULL,
  recipient_code text NOT NULL,
  reference     text NOT NULL UNIQUE,  -- ours, sent to the provider; saved before the call
  status        text NOT NULL CHECK (status IN ('requested', 'sent', 'succeeded', 'failed', 'reversed', 'needs_human')),
  transfer_code text,
  error         text,
  checks        integer NOT NULL DEFAULT 0,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX withdrawals_work ON withdrawals (status, next_check_at);

-- Off-ramp orders: Constant's charged USDC → naira into the vend partner's funding account.
CREATE TABLE offramps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  provider_order  text UNIQUE,
  reference       text NOT NULL UNIQUE,
  amount_micro    numeric(78, 0) NOT NULL CHECK (amount_micro > 0),
  send_micro      numeric(78, 0),     -- amount plus the provider's fees: what is transferred
  rate            text,
  receive_address text,
  valid_until     timestamptz,
  status          text NOT NULL CHECK (status IN ('creating', 'created', 'funding', 'funded', 'settled', 'refunded', 'expired', 'failed')),
  tx_hash         text UNIQUE,
  tx_raw          text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- One off-ramp in flight at a time.
CREATE UNIQUE INDEX offramps_one_in_flight ON offramps ((true)) WHERE status IN ('creating', 'created', 'funding', 'funded');

INSERT INTO system_flags (key, value, changed_by, reason) VALUES
  ('payouts_enabled', false, 'migration', 'off until the funding partner confirms withdrawals in writing (D-050)')
ON CONFLICT (key) DO NOTHING;
