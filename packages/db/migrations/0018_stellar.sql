-- USDC on Stellar through Constant's mandate contract (D-085).

-- A user links one Stellar account (G…), proved by signing a message with it.
ALTER TABLE user_addresses DROP CONSTRAINT user_addresses_family_check;
ALTER TABLE user_addresses ADD CONSTRAINT user_addresses_family_check CHECK (family IN ('evm', 'stellar'));
CREATE UNIQUE INDEX user_addresses_one_stellar_per_user ON user_addresses (user_id) WHERE family = 'stellar';

-- What a user is asked to sign, kept until they sign it or it lapses. Each is used once.
--   link      a message proving the Stellar account is theirs
--   onboard   the sponsored transaction that opens their account and USDC trustline (Constant pays every reserve)
--   mandate   the authorization for one bill's mandate
CREATE TABLE stellar_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  line_id    uuid REFERENCES lines(id),
  kind       text NOT NULL CHECK (kind IN ('link', 'onboard', 'mandate')),
  account    text NOT NULL,
  -- Hex: the exact bytes the user's key signs (a message hash, a transaction hash or an authorization hash).
  payload    text NOT NULL,
  data       jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stellar_requests_by_user ON stellar_requests (user_id, created_at DESC);
