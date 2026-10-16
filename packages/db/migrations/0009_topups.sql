-- Card, USSD, QR and pay-with-transfer top-ups through Paystack Checkout (D-075). Bank transfers to the user's own
-- account number keep using funding_events alone. A top-up is saved, with its reference, before Paystack is called;
-- the credit itself goes through funding_events (keyed by Paystack's transaction id), so it lands once.

CREATE TABLE topups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  provider           text NOT NULL,
  reference          text NOT NULL UNIQUE,
  credit_minor       bigint NOT NULL CHECK (credit_minor > 0),
  fee_minor          bigint NOT NULL CHECK (fee_minor >= 0),
  total_minor        bigint NOT NULL CHECK (total_minor = credit_minor + fee_minor),
  currency           text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  -- pending: checkout opened; credited: paid and in the balance; failed: abandoned or declined;
  -- mismatch: paid, but not what was quoted (a person looks; nothing is credited automatically).
  status             text NOT NULL CHECK (status IN ('pending', 'credited', 'failed', 'mismatch')),
  authorization_url  text,
  provider_event_id  text,
  channel            text,
  paid_minor         bigint,
  provider_fee_minor bigint,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topups_user ON topups (user_id, created_at DESC);
