-- Running-low reminders sent to the person (D-092): when a line was last reminded, so it's at most once a day.
ALTER TABLE lines ADD COLUMN low_reminded_at timestamptz;
