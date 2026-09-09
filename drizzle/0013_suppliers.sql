CREATE TABLE `supplier` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_name_unique` ON `supplier` (`name`);--> statement-breakpoint
-- One supplier per distinct name already on the expenses (trimmed), in the order they first appeared.
INSERT INTO `supplier` (`name`, `created_at`) SELECT trim(`supplier`), min(`created_at`) FROM `expense` GROUP BY trim(`supplier`) ORDER BY min(`voucher_number`);--> statement-breakpoint
-- Rebuild expense with supplier_id in place of the text column (SQLite cannot add a NOT NULL column to a filled table).
CREATE TABLE `__new_expense` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_number` integer NOT NULL,
	`date` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`description` text NOT NULL,
	`account_id` integer DEFAULT 11 NOT NULL,
	`amount_ex_vat_ore` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	`amount_incl_ore` integer NOT NULL,
	`paid_date` text,
	`file_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_expense` (`id`, `voucher_number`, `date`, `supplier_id`, `description`, `account_id`, `amount_ex_vat_ore`, `vat_ore`, `amount_incl_ore`, `paid_date`, `file_path`, `created_at`)
  SELECT e.`id`, e.`voucher_number`, e.`date`, s.`id`, e.`description`, e.`account_id`, e.`amount_ex_vat_ore`, e.`vat_ore`, e.`amount_incl_ore`, e.`paid_date`, e.`file_path`, e.`created_at`
  FROM `expense` e JOIN `supplier` s ON s.`name` = trim(e.`supplier`);--> statement-breakpoint
DROP TABLE `expense`;--> statement-breakpoint
ALTER TABLE `__new_expense` RENAME TO `expense`;--> statement-breakpoint
CREATE UNIQUE INDEX `expense_voucher_unique` ON `expense` (`voucher_number`);--> statement-breakpoint
CREATE INDEX `expense_date_idx` ON `expense` (`date`);--> statement-breakpoint
CREATE INDEX `expense_account_idx` ON `expense` (`account_id`);--> statement-breakpoint
CREATE INDEX `expense_supplier_idx` ON `expense` (`supplier_id`);
