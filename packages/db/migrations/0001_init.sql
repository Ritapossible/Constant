-- Constant: first schema. One bill end to end (cable renewal), on the line model (ARCHITECTURE "Next shape").
-- Money is bigint minor units next to a currency. Times are timestamptz (UTC).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE markets (
  code           text PRIMARY KEY,                 -- 'NG'
  currency       text NOT NULL,                    -- 'NGN'
  time_zone      text NOT NULL,                    -- 'Africa/Lagos'
  default_locale text NOT NULL,
  enabled        boolean NOT NULL DEFAULT false
);

-- Constant's fee per product, per market (D-020, D-031). Data, not code.
CREATE TABLE fees (
  market_code text NOT NULL REFERENCES markets(code),
  kind        text NOT NULL,
  fee_minor   bigint NOT NULL CHECK (fee_minor >= 0),
  PRIMARY KEY (market_code, kind)
);

-- Products we can sell, enabled one by one (D-038 applies to DisCos; the same for cable providers).
CREATE TABLE providers (
  code        text PRIMARY KEY,                    -- 'dstv', 'gotv', 'startimes'
  kind        text NOT NULL,                       -- 'tv'
  market_code text NOT NULL REFERENCES markets(code),
  name        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT false
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_did     text NOT NULL UNIQUE,
  display_name  text,
  email         text,
  phone_e164    text,
  market_code   text NOT NULL DEFAULT 'NG' REFERENCES markets(code),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  frozen_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A line is one thing that can run out. The payee (smartcard) is fixed at creation and stored encrypted.
CREATE TABLE lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  kind            text NOT NULL CHECK (kind IN ('tv')),
  provider        text NOT NULL REFERENCES providers(code),
  ref_ciphertext  text NOT NULL,
  ref_hmac        text NOT NULL,
  ref_last4       text NOT NULL,
  customer_name   text,
  plan_name       text,
  nickname        text NOT NULL,
  currency        text NOT NULL,
  cap_minor       bigint NOT NULL CHECK (cap_minor > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'frozen', 'cancelled')),
  frozen_reason   text,
  verified        boolean NOT NULL DEFAULT false,
  due_at          timestamptz,
  next_run_at     timestamptz,
  last_renewed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lines_one_live_per_payee ON lines (user_id, provider, ref_hmac) WHERE status <> 'cancelled';
CREATE INDEX lines_due ON lines (next_run_at) WHERE status = 'active';

-- Append-only. Balance is the sum. Every entry has a unique idempotency key.
CREATE TABLE ledger_entries (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id),
  line_id         uuid REFERENCES lines(id),
  order_id        uuid,
  kind            text NOT NULL CHECK (kind IN ('fund', 'vend', 'fee', 'refund', 'adjust', 'reversal', 'withdrawal')),
  amount_minor    bigint NOT NULL CHECK (amount_minor <> 0),
  currency        text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  external_ref    text,
  actor           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_by_user ON ledger_entries (user_id);

CREATE FUNCTION ledger_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END $$;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();

-- The orders table is also the work queue: the worker claims rows with FOR UPDATE SKIP LOCKED (D-058).
CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  line_id         uuid NOT NULL REFERENCES lines(id),
  trigger         text NOT NULL CHECK (trigger IN ('renewal')),
  state           text NOT NULL CHECK (state IN ('ready', 'vending', 'token_stored', 'notifying', 'settled', 'failed', 'needs_human')),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor       bigint NOT NULL CHECK (fee_minor >= 0),
  currency        text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  scheduled_for   timestamptz,
  partner         text NOT NULL,
  -- Our request id at the partner. Written before the vend call, so a crash can always ask about it.
  partner_ref     text UNIQUE,
  partner_txn_id  text,
  checks          integer NOT NULL DEFAULT 0,
  next_check_at   timestamptz,
  error           text,
  receipt_id      text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz
);
-- One open order per line (D-004, INV-20).
CREATE UNIQUE INDEX orders_one_open_per_line ON orders (line_id)
  WHERE state IN ('ready', 'vending', 'token_stored', 'notifying', 'needs_human');
CREATE INDEX orders_work ON orders (state, next_check_at);

CREATE TABLE order_events (
  id         bigserial PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES orders(id),
  from_state text,
  to_state   text NOT NULL,
  event      text NOT NULL,
  detail     jsonb,
  actor      text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_by_order ON order_events (order_id);

-- Each user's own bank account number for naira transfers (D-022).
CREATE TABLE funding_accounts (
  user_id        uuid PRIMARY KEY REFERENCES users(id),
  provider       text NOT NULL,
  customer_code  text NOT NULL,
  account_number text NOT NULL,
  bank_name      text NOT NULL,
  account_name   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, customer_code)
);

-- Every inbound webhook, stored raw before anything acts on it (CLAUDE.md rule 7).
CREATE TABLE inbound_webhooks (
  id           bigserial PRIMARY KEY,
  provider     text NOT NULL,
  signature_ok boolean NOT NULL,
  raw          text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE funding_events (
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  user_id           uuid REFERENCES users(id),
  amount_minor      bigint NOT NULL,
  currency          text NOT NULL,
  status            text NOT NULL CHECK (status IN ('credited', 'rejected')),
  reason            text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_event_id)
);

-- Messages to users. Unique key = sent at most once (INV-23). Also a work queue.
CREATE TABLE notices (
  id              bigserial PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  user_id         uuid NOT NULL REFERENCES users(id),
  line_id         uuid REFERENCES lines(id),
  order_id        uuid REFERENCES orders(id),
  kind            text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  channel         text,
  provider_msg_id text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX notices_work ON notices (status, next_attempt_at);

-- Things a person must look at. Paging reads this table.
CREATE TABLE ops_alerts (
  id          bigserial PRIMARY KEY,
  severity    text NOT NULL CHECK (severity IN ('page', 'warn')),
  kind        text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);

CREATE TABLE system_flags (
  key        text PRIMARY KEY,
  value      boolean NOT NULL,
  changed_by text NOT NULL,
  reason     text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Seed. Vending starts OFF: a person turns it on after the partner sandbox checks pass.
INSERT INTO markets (code, currency, time_zone, default_locale, enabled) VALUES ('NG', 'NGN', 'Africa/Lagos', 'en-NG', true);
INSERT INTO fees (market_code, kind, fee_minor) VALUES ('NG', 'tv', 0), ('NG', 'electricity', 10000), ('NG', 'data', 0), ('NG', 'airtime', 0);
INSERT INTO providers (code, kind, market_code, name, enabled) VALUES
  ('dstv', 'tv', 'NG', 'DSTV', true),
  ('gotv', 'tv', 'NG', 'GOtv', true),
  ('startimes', 'tv', 'NG', 'StarTimes', true);
INSERT INTO system_flags (key, value, changed_by, reason) VALUES ('vending_enabled', false, 'migration', 'off until a person turns it on');
