-- Bills waiting on the person (D-091): why a bill is held this cycle, the run time it was held at, and when they were
-- last told. Money arriving makes a bill held for money due at once; reminders before it lapses are spaced from the
-- last message. Cleared whenever the bill's schedule moves (paid, rescheduled, paused and resumed).
ALTER TABLE lines ADD COLUMN held_reason text CHECK (held_reason IN ('insufficient', 'above_cap', 'weekly_cap'));
ALTER TABLE lines ADD COLUMN held_since timestamptz;
ALTER TABLE lines ADD COLUMN held_notified_at timestamptz;
CREATE INDEX lines_held_for_money ON lines (user_id) WHERE held_reason = 'insufficient';
