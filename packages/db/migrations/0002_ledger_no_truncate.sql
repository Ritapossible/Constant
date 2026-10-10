-- TRUNCATE skips row triggers, so the ledger needs its own statement trigger to stay append-only.
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_is_append_only();
