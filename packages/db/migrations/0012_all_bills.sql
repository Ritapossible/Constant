-- Every bill on the server (D-079): data, airtime, electricity and subscriptions join cable TV. Nothing about a
-- user's bills lives only on their phone any more.

-- A provider code is unique per kind ('mtn' sells both data and airtime).
ALTER TABLE lines DROP CONSTRAINT lines_provider_fkey;
ALTER TABLE providers DROP CONSTRAINT providers_pkey;
ALTER TABLE providers ADD PRIMARY KEY (code, kind);

INSERT INTO providers (code, kind, market_code, name, enabled) VALUES
  ('mtn', 'data', 'NG', 'MTN', true), ('airtel', 'data', 'NG', 'Airtel', true), ('glo', 'data', 'NG', 'Glo', true), ('9mobile', 'data', 'NG', 'T2', true),
  ('mtn', 'airtime', 'NG', 'MTN', true), ('airtel', 'airtime', 'NG', 'Airtel', true), ('glo', 'airtime', 'NG', 'Glo', true), ('9mobile', 'airtime', 'NG', 'T2', true),
  ('ikedc', 'electricity', 'NG', 'Ikeja Electric', true), ('ekedc', 'electricity', 'NG', 'Eko Electricity', true),
  ('aedc', 'electricity', 'NG', 'Abuja Electricity', true), ('eedc', 'electricity', 'NG', 'Enugu Electricity', true),
  ('ibedc', 'electricity', 'NG', 'Ibadan Electricity', false), ('phed', 'electricity', 'NG', 'Port Harcourt Electricity', false),
  ('bedc', 'electricity', 'NG', 'Benin Electricity', false), ('kedco', 'electricity', 'NG', 'Kano Electricity', false),
  ('kaedco', 'electricity', 'NG', 'Kaduna Electric', false), ('jed', 'electricity', 'NG', 'Jos Electricity', false),
  ('yedc', 'electricity', 'NG', 'Yola Electricity', false), ('aba', 'electricity', 'NG', 'APL Electric', false),
  -- Subscriptions are tracked, not paid, until a licensed card issuer is in place (D-039).
  ('chatgpt', 'subscription', 'NG', 'ChatGPT', true), ('claude', 'subscription', 'NG', 'Claude', true),
  ('gemini', 'subscription', 'NG', 'Gemini', true), ('spotify', 'subscription', 'NG', 'Spotify', true),
  ('netflix', 'subscription', 'NG', 'Netflix', true)
ON CONFLICT DO NOTHING;

ALTER TABLE lines DROP CONSTRAINT lines_kind_check;
ALTER TABLE lines ADD CONSTRAINT lines_kind_check CHECK (kind IN ('tv', 'data', 'airtime', 'electricity', 'subscription'));
ALTER TABLE lines ADD CONSTRAINT lines_provider_fkey FOREIGN KEY (provider, kind) REFERENCES providers (code, kind);

-- When a line pays. due_date: cable, the day before the subscription ends. monthly: on renew_day at 07:00 Lagos.
-- usage: when the user reports it low (a reading at or below threshold) or taps "top up now". none: never paid.
ALTER TABLE lines ADD COLUMN schedule text NOT NULL DEFAULT 'due_date' CHECK (schedule IN ('due_date', 'monthly', 'usage', 'none'));
ALTER TABLE lines ADD COLUMN renew_day smallint CHECK (renew_day BETWEEN 1 AND 28);
-- The amount each payment buys (airtime, electricity; data: the bundle's price when it was chosen). Null for cable,
-- whose price comes from a fresh lookup every time.
ALTER TABLE lines ADD COLUMN amount_minor bigint CHECK (amount_minor > 0);
ALTER TABLE lines ADD COLUMN variation_code text;
ALTER TABLE lines ADD COLUMN meter_type text CHECK (meter_type IN ('prepaid', 'postpaid'));
ALTER TABLE lines ADD COLUMN threshold numeric(14, 2) CHECK (threshold >= 0);
ALTER TABLE lines ADD COLUMN weekly_cap_minor bigint CHECK (weekly_cap_minor > 0);
-- Something the user must do before the line can pay (an imported data bill has no bundle yet).
ALTER TABLE lines ADD COLUMN setup_needed text CHECK (setup_needed IN ('bundle'));
ALTER TABLE lines ADD CONSTRAINT lines_schedule_shape CHECK (
  (schedule <> 'monthly' OR renew_day IS NOT NULL) AND
  (schedule <> 'usage' OR threshold IS NOT NULL) AND
  (kind = 'tv' OR kind = 'subscription' OR amount_minor IS NOT NULL) AND
  (kind <> 'electricity' OR meter_type IS NOT NULL)
);

-- What's left on a usage line, as the user reported it. The forecast in the app reads these.
CREATE TABLE line_readings (
  id      bigserial PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES lines(id),
  value   numeric(14, 2) NOT NULL CHECK (value >= 0),
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX line_readings_by_line ON line_readings (line_id, at DESC);

-- A usage line may be topped up on demand, not only on a schedule.
ALTER TABLE orders DROP CONSTRAINT orders_trigger_check;
ALTER TABLE orders ADD CONSTRAINT orders_trigger_check CHECK (trigger IN ('renewal', 'scheduled', 'usage'));
-- The electricity token, encrypted like a meter number. Shown only to its owner and sent only to them.
ALTER TABLE orders ADD COLUMN token_ciphertext text;
ALTER TABLE orders ADD COLUMN token_units text;

-- Where the user wants messages, in order (D-054). Channels not yet connected are skipped when sending.
ALTER TABLE users ADD COLUMN channels text[] NOT NULL DEFAULT '{whatsapp,sms}'
  CHECK (channels <@ ARRAY['whatsapp', 'telegram', 'sms', 'email']::text[]);
