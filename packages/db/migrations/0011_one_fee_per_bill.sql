-- One fee per delivered bill (D-077, replaces D-076's autopay fee): data ₦50, airtime ₦30, cable ₦100,
-- electricity ₦100, and the first delivered payment on an account free. Must match packages/rules pricing.ts.
UPDATE fees SET fee_minor = CASE kind WHEN 'data' THEN 5000 WHEN 'airtime' THEN 3000 WHEN 'tv' THEN 10000 WHEN 'electricity' THEN 10000 END
WHERE market_code = 'NG' AND kind IN ('data', 'airtime', 'tv', 'electricity');
ALTER TABLE markets DROP COLUMN autopay_fee_minor;
ALTER TABLE markets DROP COLUMN free_autopay_lines;
