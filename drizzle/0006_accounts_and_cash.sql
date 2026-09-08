CREATE TABLE `account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_number_unique` ON `account` (`number`);--> statement-breakpoint
-- Fixed mini-kontoplan. Ids are explicit because invoice_line.account_id defaults to 1 and expense.account_id to 11.
INSERT INTO `account` (`id`, `number`, `name`, `type`) VALUES
  (1, 1000, 'Konsulentydelser', 'revenue'),
  (2, 1100, 'Andet salg', 'revenue'),
  (3, 1200, 'Momsfrit salg', 'revenue'),
  (4, 2000, 'Software og hosting', 'cost'),
  (5, 2100, 'Kontorhold', 'cost'),
  (6, 2200, 'Repræsentation', 'cost'),
  (7, 2300, 'Rejser og transport', 'cost'),
  (8, 2400, 'Forsikring og kontingenter', 'cost'),
  (9, 2500, 'Revisor og rådgivning', 'cost'),
  (10, 2600, 'Markedsføring', 'cost'),
  (11, 2900, 'Øvrige omkostninger', 'cost');--> statement-breakpoint
CREATE TABLE `cash_movement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cash_movement_date_idx` ON `cash_movement` (`date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_expense` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_number` integer NOT NULL,
	`date` text NOT NULL,
	`supplier` text NOT NULL,
	`description` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`account_id` integer DEFAULT 11 NOT NULL,
	`amount_ex_vat_ore` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	`amount_incl_ore` integer NOT NULL,
	`paid_date` text,
	`file_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_expense`("id", "voucher_number", "date", "supplier", "description", "category", "account_id", "amount_ex_vat_ore", "vat_ore", "amount_incl_ore", "paid_date", "file_path", "created_at") SELECT "id", "voucher_number", "date", "supplier", "description", "category", 11, "amount_ex_vat_ore", "vat_ore", "amount_incl_ore", "paid_date", "file_path", "created_at" FROM `expense`;--> statement-breakpoint
DROP TABLE `expense`;--> statement-breakpoint
ALTER TABLE `__new_expense` RENAME TO `expense`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `expense_voucher_unique` ON `expense` (`voucher_number`);--> statement-breakpoint
CREATE INDEX `expense_date_idx` ON `expense` (`date`);--> statement-breakpoint
CREATE INDEX `expense_account_idx` ON `expense` (`account_id`);--> statement-breakpoint
ALTER TABLE `invoice_line` ADD `account_id` integer DEFAULT 1 NOT NULL REFERENCES account(id);--> statement-breakpoint
CREATE INDEX `invoice_line_account_idx` ON `invoice_line` (`account_id`);