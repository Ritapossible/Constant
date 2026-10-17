-- The autopay fee (D-076): a fee on every automatic payment, except on each user's first bill(s) on autopay.
-- Per market, like the fees table; must match AUTOPAY in packages/rules/src/pricing.ts (db test).
ALTER TABLE markets ADD COLUMN autopay_fee_minor bigint NOT NULL DEFAULT 0 CHECK (autopay_fee_minor >= 0);
ALTER TABLE markets ADD COLUMN free_autopay_lines integer NOT NULL DEFAULT 1 CHECK (free_autopay_lines >= 0);
UPDATE markets SET autopay_fee_minor = 5000, free_autopay_lines = 1 WHERE code = 'NG';
