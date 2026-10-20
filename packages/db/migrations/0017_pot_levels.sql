-- Filling pots when money arrives (D-084): the level a bill's pot is kept at. NULL: filled only by hand.
ALTER TABLE lines ADD COLUMN pot_target_minor bigint CHECK (pot_target_minor > 0);
