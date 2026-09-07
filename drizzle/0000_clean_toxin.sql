CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer NOT NULL,
	`action` text NOT NULL,
	`detail_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`zip` text NOT NULL,
	`city` text NOT NULL,
	`country` text DEFAULT 'DK' NOT NULL,
	`cvr` text,
	`email` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expense` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_number` integer NOT NULL,
	`date` text NOT NULL,
	`supplier` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`amount_ex_vat_ore` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	`amount_incl_ore` integer NOT NULL,
	`paid_date` text,
	`file_path` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_voucher_unique` ON `expense` (`voucher_number`);--> statement-breakpoint
CREATE TABLE `invoice` (
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
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_number_unique` ON `invoice` (`invoice_number`);--> statement-breakpoint
CREATE TABLE `invoice_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`unit_price_ore` integer NOT NULL,
	`line_total_ore` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
