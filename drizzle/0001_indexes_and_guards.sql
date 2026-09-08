CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `expense_date_idx` ON `expense` (`date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invoice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_number` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`customer_id` integer NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`currency` text DEFAULT 'DKK' NOT NULL,
	`subtotal_ore` integer DEFAULT 0 NOT NULL,
	`vat_ore` integer DEFAULT 0 NOT NULL,
	`total_ore` integer DEFAULT 0 NOT NULL,
	`vat_rate_bp` integer DEFAULT 2500 NOT NULL,
	`vat_exempt_reason` text,
	`payment_reference` text DEFAULT '' NOT NULL,
	`paid_date` text,
	`pdf_path` text,
	`credited_by_invoice_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credited_by_invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_invoice`("id", "invoice_number", "status", "customer_id", "issue_date", "due_date", "currency", "subtotal_ore", "vat_ore", "total_ore", "vat_rate_bp", "vat_exempt_reason", "payment_reference", "paid_date", "pdf_path", "credited_by_invoice_id", "created_at") SELECT "id", "invoice_number", "status", "customer_id", "issue_date", "due_date", "currency", "subtotal_ore", "vat_ore", "total_ore", "vat_rate_bp", "vat_exempt_reason", "payment_reference", "paid_date", "pdf_path", "credited_by_invoice_id", "created_at" FROM `invoice`;--> statement-breakpoint
DROP TABLE `invoice`;--> statement-breakpoint
ALTER TABLE `__new_invoice` RENAME TO `invoice`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_number_unique` ON `invoice` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `invoice_customer_idx` ON `invoice` (`customer_id`);--> statement-breakpoint
CREATE INDEX `invoice_issue_date_idx` ON `invoice` (`issue_date`);--> statement-breakpoint
CREATE INDEX `invoice_status_idx` ON `invoice` (`status`);--> statement-breakpoint
CREATE INDEX `invoice_line_invoice_idx` ON `invoice_line` (`invoice_id`);--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log` BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log` BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_no_delete_issued` BEFORE DELETE ON `invoice` WHEN OLD.status <> 'draft' BEGIN SELECT RAISE(ABORT, 'issued invoices cannot be deleted'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_immutable_issued` BEFORE UPDATE ON `invoice` WHEN OLD.status <> 'draft' AND (
  NEW.invoice_number IS NOT OLD.invoice_number OR NEW.customer_id <> OLD.customer_id OR NEW.issue_date <> OLD.issue_date
  OR NEW.due_date <> OLD.due_date OR NEW.currency <> OLD.currency OR NEW.subtotal_ore <> OLD.subtotal_ore
  OR NEW.vat_ore <> OLD.vat_ore OR NEW.total_ore <> OLD.total_ore OR NEW.vat_rate_bp <> OLD.vat_rate_bp
  OR NEW.vat_exempt_reason IS NOT OLD.vat_exempt_reason OR NEW.payment_reference <> OLD.payment_reference
  OR NEW.pdf_path IS NOT OLD.pdf_path OR NEW.created_at <> OLD.created_at OR NEW.status = 'draft'
) BEGIN SELECT RAISE(ABORT, 'issued invoices are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_line_no_insert_issued` BEFORE INSERT ON `invoice_line` WHEN (SELECT status FROM invoice WHERE id = NEW.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'lines of issued invoices are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_line_no_update_issued` BEFORE UPDATE ON `invoice_line` WHEN (SELECT status FROM invoice WHERE id = OLD.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'lines of issued invoices are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_line_no_delete_issued` BEFORE DELETE ON `invoice_line` WHEN (SELECT status FROM invoice WHERE id = OLD.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'lines of issued invoices are immutable'); END;
