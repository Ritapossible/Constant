-- Base, Arc and Stellar (D-060 to D-062).

-- Users' own addresses, learned from the identity provider server-side, never from the browser.
CREATE TABLE user_addresses (
  family     text NOT NULL CHECK (family IN ('evm')),
  address    text NOT NULL,                 -- checksummed
  user_id    uuid NOT NULL REFERENCES users(id),
  kind       text NOT NULL CHECK (kind IN ('embedded', 'external')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family, address)
);
CREATE INDEX user_addresses_by_user ON user_addresses (user_id);

-- How far the deposit indexer has read each chain.
CREATE TABLE chain_cursors (
  chain      text PRIMARY KEY,
  last_block bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every token transfer into a user's address. The money stays in the user's own account (non-custodial);
-- this is the record, the notice, and the quarantine list for tokens we don't accept (INV-46).
CREATE TABLE chain_deposits (
  chain        text NOT NULL,
  tx_hash      text NOT NULL,
  log_index    integer NOT NULL,
  user_id      uuid NOT NULL REFERENCES users(id),
  address      text NOT NULL,
  from_address text NOT NULL,
  token        text NOT NULL,
  token_key    text,                         -- 'base-usdc' etc.; NULL when quarantined
  amount_raw   numeric(78, 0) NOT NULL,      -- uint256; a spam token can exceed bigint
  status       text NOT NULL CHECK (status IN ('accepted', 'quarantined')),
  block_number bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, tx_hash, log_index)
);
CREATE INDEX chain_deposits_by_user ON chain_deposits (user_id, created_at DESC);

-- Public receipts: Merkle roots of settled orders, written to Stellar (D-062).
CREATE TABLE anchor_batches (
  id          bigserial PRIMARY KEY,
  network     text NOT NULL,
  root        text NOT NULL,
  leaf_count  integer NOT NULL,
  status      text NOT NULL CHECK (status IN ('pending', 'anchored')),
  tx_hash     text,
  ledger      integer,
  attempts    integer NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  anchored_at timestamptz
);

CREATE TABLE anchor_items (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  batch_id bigint NOT NULL REFERENCES anchor_batches(id),
  leaf     text NOT NULL,
  proof    jsonb NOT NULL
);
CREATE INDEX anchor_items_by_batch ON anchor_items (batch_id);
