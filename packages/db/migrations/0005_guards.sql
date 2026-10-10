-- Guards from the 2026-10-10 review (D-064): address screening, a global switch and daily limit for dollar
-- charges, sweeping charged USDC to the treasury, and paging that doesn't repeat itself.

ALTER TABLE chain_deposits ADD COLUMN screening text NOT NULL DEFAULT 'pending'
  CHECK (screening IN ('pending', 'clear', 'flagged', 'not_required'));
-- Unsupported tokens are never used, so they need no screening; deposits recorded before this existed are rechecked.
UPDATE chain_deposits SET screening = 'not_required' WHERE status = 'quarantined';

-- Screening of the user's own smart account, done when a permission is accepted.
ALTER TABLE user_addresses ADD COLUMN screening text NOT NULL DEFAULT 'pending'
  CHECK (screening IN ('pending', 'clear', 'flagged', 'not_required'));

ALTER TABLE ops_alerts ADD COLUMN dedupe_key text UNIQUE;

INSERT INTO system_flags (key, value, changed_by, reason)
VALUES ('dollar_charges_enabled', true, 'migration', 'on; trips off at the daily limit')
ON CONFLICT (key) DO NOTHING;

-- Charged USDC moves from the spender (a hot key) to the treasury, so a stolen key holds little.
CREATE TABLE sweeps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain        text NOT NULL,
  token        text NOT NULL,
  to_address   text NOT NULL,
  amount       numeric(78, 0) NOT NULL CHECK (amount > 0),
  status       text NOT NULL CHECK (status IN ('submitted', 'confirmed', 'failed')),
  tx_hash      text NOT NULL UNIQUE,
  tx_raw       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
-- At most one sweep in flight per chain and token.
CREATE UNIQUE INDEX sweeps_one_in_flight ON sweeps (chain, token) WHERE status = 'submitted';
