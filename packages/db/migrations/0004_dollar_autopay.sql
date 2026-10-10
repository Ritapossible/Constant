-- Paying naira bills from USDC on Base with spend permissions (D-063).

ALTER TABLE user_addresses DROP CONSTRAINT user_addresses_kind_check;
ALTER TABLE user_addresses ADD CONSTRAINT user_addresses_kind_check CHECK (kind IN ('embedded', 'external', 'smart'));

-- How a line is paid: from the naira balance, or charged from the user's USDC on Base.
ALTER TABLE lines ADD COLUMN funding text NOT NULL DEFAULT 'naira' CHECK (funding IN ('naira', 'usdc_base'));
ALTER TABLE orders ADD COLUMN funding text NOT NULL DEFAULT 'naira' CHECK (funding IN ('naira', 'usdc_base'));

-- One signed permission per line. Constant may take at most `allowance` USDC per `period` from `account`.
CREATE TABLE spend_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  line_id     uuid NOT NULL REFERENCES lines(id),
  chain       text NOT NULL DEFAULT 'base',
  account     text NOT NULL,
  spender     text NOT NULL,
  token       text NOT NULL,
  allowance   numeric(78, 0) NOT NULL,
  period      bigint NOT NULL,
  start_at    bigint NOT NULL,
  end_at      bigint NOT NULL,
  salt        numeric(78, 0) NOT NULL,
  extra_data  text NOT NULL,
  signature   text NOT NULL,
  status      text NOT NULL CHECK (status IN ('signed', 'approving', 'approved', 'revoke_pending', 'revoked', 'failed')),
  tx_hash     text,
  tx_raw      text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account, salt)
);
CREATE UNIQUE INDEX spend_permissions_one_live_per_line ON spend_permissions (line_id)
  WHERE status IN ('signed', 'approving', 'approved');

-- One on-chain charge per dollar-funded order. The transaction is signed and its hash saved before it is sent.
CREATE TABLE charges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL UNIQUE REFERENCES orders(id),
  permission_id uuid NOT NULL REFERENCES spend_permissions(id),
  usdc_micro    numeric(78, 0) NOT NULL CHECK (usdc_micro > 0),
  kobo_per_usdc bigint NOT NULL CHECK (kobo_per_usdc > 0),
  naira_minor   bigint NOT NULL CHECK (naira_minor > 0),
  status        text NOT NULL CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  tx_hash       text UNIQUE,
  tx_raw        text,
  submitted_at  timestamptz,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at  timestamptz
);
