-- Closing an account (D-081). The person's contact details, payees, readings and sign-in link are erased; the
-- money record (ledger, orders, funding events) stays, without anything that identifies them, for as long as the law
-- requires financial records to be kept.
ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'frozen', 'closed'));
ALTER TABLE users ADD COLUMN closed_at timestamptz;
