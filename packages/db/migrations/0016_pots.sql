-- Pots (D-083): money set aside for one bill. Each ledger entry belongs to free money (pot_line_id NULL) or to one
-- bill's pot. A move between them is two entries that sum to zero, so a user's balance is still the sum of their
-- entries and the ledger stays append-only.
ALTER TABLE ledger_entries ADD COLUMN pot_line_id uuid REFERENCES lines(id);
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_kind_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_kind_check
  CHECK (kind IN ('fund', 'vend', 'fee', 'refund', 'adjust', 'reversal', 'withdrawal', 'pot'));
CREATE INDEX ledger_by_pot ON ledger_entries (pot_line_id) WHERE pot_line_id IS NOT NULL;
