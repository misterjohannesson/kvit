-- Cash movements are a journal: rows are created, never edited or deleted (mistakes get a `correction`).
CREATE TRIGGER `cash_movement_no_update` BEFORE UPDATE ON `cash_movement` BEGIN SELECT RAISE(ABORT, 'cash movements are append-only'); END;--> statement-breakpoint
CREATE TRIGGER `cash_movement_no_delete` BEFORE DELETE ON `cash_movement` BEGIN SELECT RAISE(ABORT, 'cash movements are append-only'); END;
--> statement-breakpoint
-- Accounts are rename-only: number and type are part of every booked row's meaning.
CREATE TRIGGER `account_identity_immutable` BEFORE UPDATE ON `account` WHEN NEW.number <> OLD.number OR NEW.type <> OLD.type BEGIN SELECT RAISE(ABORT, 'accounts can only be renamed'); END;
