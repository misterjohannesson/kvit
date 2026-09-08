CREATE TABLE `invoice_attachment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`file_path` text NOT NULL,
	`pages` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_attachment_invoice_idx` ON `invoice_attachment` (`invoice_id`);--> statement-breakpoint
ALTER TABLE `invoice` ADD `sent_at` text;--> statement-breakpoint
-- sent_at is written once (NULL -> date) and only on an issued document; it never moves again.
CREATE TRIGGER `invoice_sent_once` BEFORE UPDATE ON `invoice` WHEN NEW.sent_at IS NOT OLD.sent_at AND (OLD.sent_at IS NOT NULL OR NEW.status = 'draft') BEGIN SELECT RAISE(ABORT, 'sent_at is set once, on issued documents only'); END;--> statement-breakpoint
-- Attachments are part of the issued document: frozen with the invoice, like its lines.
CREATE TRIGGER `invoice_attachment_no_insert_issued` BEFORE INSERT ON `invoice_attachment` WHEN (SELECT status FROM invoice WHERE id = NEW.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'attachments of issued invoices are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_attachment_no_update_issued` BEFORE UPDATE ON `invoice_attachment` WHEN (SELECT status FROM invoice WHERE id = OLD.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'attachments of issued invoices are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_attachment_no_delete_issued` BEFORE DELETE ON `invoice_attachment` WHEN (SELECT status FROM invoice WHERE id = OLD.invoice_id) <> 'draft' BEGIN SELECT RAISE(ABORT, 'attachments of issued invoices are immutable'); END;
