-- Paying bills from USDT on Base as well as USDC (D-069). A line may hold one live permission per chain and
-- token; the worker charges the first one that can pay, USDC first. Arc will add rows with chain = 'arc'.

-- "Paid from the user's stablecoins", whichever token or chain the charge uses.
ALTER TABLE lines DROP CONSTRAINT lines_funding_check;
ALTER TABLE orders DROP CONSTRAINT orders_funding_check;
UPDATE lines SET funding = 'stables' WHERE funding = 'usdc_base';
UPDATE orders SET funding = 'stables' WHERE funding = 'usdc_base';
ALTER TABLE lines ADD CONSTRAINT lines_funding_check CHECK (funding IN ('naira', 'stables'));
ALTER TABLE orders ADD CONSTRAINT orders_funding_check CHECK (funding IN ('naira', 'stables'));

DROP INDEX spend_permissions_one_live_per_line;
CREATE UNIQUE INDEX spend_permissions_one_live_per_token ON spend_permissions (line_id, chain, lower(token))
  WHERE status IN ('signed', 'approving', 'approved');

-- A charge names its token. Amounts are in the token's micro-units (USDC and USDT both have 6 decimals).
ALTER TABLE charges RENAME COLUMN usdc_micro TO amount_micro;
ALTER TABLE charges RENAME COLUMN kobo_per_usdc TO kobo_per_unit;
ALTER TABLE charges ADD COLUMN chain text NOT NULL DEFAULT 'base';
ALTER TABLE charges ADD COLUMN token text NOT NULL DEFAULT '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
ALTER TABLE charges ALTER COLUMN chain DROP DEFAULT;
ALTER TABLE charges ALTER COLUMN token DROP DEFAULT;

-- The off-ramp sells whichever token the spender holds most of.
ALTER TABLE offramps ADD COLUMN token text NOT NULL DEFAULT '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
ALTER TABLE offramps ALTER COLUMN token DROP DEFAULT;
