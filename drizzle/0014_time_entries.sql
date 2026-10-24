CREATE TABLE `time_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`date` text NOT NULL,
	`minutes` integer NOT NULL,
	`description` text NOT NULL,
	`billable` integer DEFAULT true NOT NULL,
	`invoice_id` integer,
	`group_id` integer,
	`position` integer,
	`invoiced_hours` real,
	`invoiced_description` text,
	`rate_ore` integer,
	`standard_rate_ore` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `time_group`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entry_customer_idx` ON `time_entry` (`customer_id`);--> statement-breakpoint
CREATE INDEX `time_entry_invoice_idx` ON `time_entry` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `time_entry_date_idx` ON `time_entry` (`date`);--> statement-breakpoint
CREATE TABLE `time_group` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_group_invoice_idx` ON `time_group` (`invoice_id`);--> statement-breakpoint
ALTER TABLE `customer` ADD `hourly_rate_ore` integer;--> statement-breakpoint
ALTER TABLE `invoice_line` ADD `kind` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Logged time on any invoice (draft or issued) is locked; only the invoiced part may change, and only on a draft.
CREATE TRIGGER `time_entry_logged_locked` BEFORE UPDATE ON `time_entry` WHEN OLD.invoice_id IS NOT NULL AND (NEW.customer_id IS NOT OLD.customer_id OR NEW.date IS NOT OLD.date OR NEW.minutes IS NOT OLD.minutes OR NEW.description IS NOT OLD.description OR NEW.billable IS NOT OLD.billable) BEGIN SELECT RAISE(ABORT, 'logged time on an invoice is locked'); END;--> statement-breakpoint
-- Time on an issued or credited invoice is part of that document: frozen with it, never released.
CREATE TRIGGER `time_entry_no_update_issued` BEFORE UPDATE ON `time_entry` WHEN OLD.invoice_id IS NOT NULL AND (SELECT status FROM invoice WHERE id = OLD.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'time on issued invoices is immutable'); END;--> statement-breakpoint
CREATE TRIGGER `time_entry_no_attach_issued` BEFORE UPDATE ON `time_entry` WHEN NEW.invoice_id IS NOT NULL AND NEW.invoice_id IS NOT OLD.invoice_id AND (SELECT status FROM invoice WHERE id = NEW.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'time can only be put on a draft'); END;--> statement-breakpoint
CREATE TRIGGER `time_entry_no_insert_issued` BEFORE INSERT ON `time_entry` WHEN NEW.invoice_id IS NOT NULL AND (SELECT status FROM invoice WHERE id = NEW.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'time can only be put on a draft'); END;--> statement-breakpoint
CREATE TRIGGER `time_entry_no_delete_billed` BEFORE DELETE ON `time_entry` WHEN OLD.invoice_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'time on an invoice cannot be deleted'); END;--> statement-breakpoint
CREATE TRIGGER `time_group_no_insert_issued` BEFORE INSERT ON `time_group` WHEN (SELECT status FROM invoice WHERE id = NEW.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'headings of issued invoices are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `time_group_no_update_issued` BEFORE UPDATE ON `time_group` WHEN (SELECT status FROM invoice WHERE id = OLD.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'headings of issued invoices are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `time_group_no_delete_issued` BEFORE DELETE ON `time_group` WHEN (SELECT status FROM invoice WHERE id = OLD.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'headings of issued invoices are immutable'); END;
