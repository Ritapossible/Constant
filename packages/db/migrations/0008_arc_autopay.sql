-- USDC on Arc pays bills too (D-070). Permissions and charges already carry `chain`; this adds the transfer of
-- Constant's own charged USDC from Arc to Base with CCTP, so it can be off-ramped. One transfer in flight.

CREATE TABLE bridges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_chain    text NOT NULL,
  to_chain      text NOT NULL,
  amount_micro  numeric(78, 0) NOT NULL CHECK (amount_micro > 0),
  max_fee_micro numeric(78, 0) NOT NULL CHECK (max_fee_micro >= 0),
  -- burning: approve and burn signed and saved, then sent; attesting: waiting for Circle; minting: mint sent on the
  -- destination; done: minted. failed: nothing left the source chain (or a person must look: see error).
  status        text NOT NULL CHECK (status IN ('burning', 'attesting', 'minting', 'done', 'failed')),
  approve_hash  text NOT NULL UNIQUE,
  approve_raw   text,
  burn_hash     text NOT NULL UNIQUE,
  burn_raw      text,
  message       text,
  attestation   text,
  mint_hash     text UNIQUE,
  mint_raw      text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bridges_one_in_flight ON bridges ((true)) WHERE status IN ('burning', 'attesting', 'minting');
