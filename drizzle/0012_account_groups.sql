-- Kontoplan groups (report subtotals) and archiving. The default kontoplan stays the eleven accounts from 0006 with
-- no groups; the larger grouped plan is an optional CSV template the owner can upload from Indstillinger.
ALTER TABLE `account` ADD `group_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `account` ADD `archived` integer DEFAULT 0 NOT NULL;
