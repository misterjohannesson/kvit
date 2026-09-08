ALTER TABLE `account` ADD `group_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `account` ADD `archived` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Group the eleven accounts seeded by 0006. Only rows without a group are touched, so a rerun is a no-op.
UPDATE `account` SET `group_name` = 'Omsætning' WHERE `group_name` = '' AND `type` = 'revenue';--> statement-breakpoint
UPDATE `account` SET `group_name` = 'IT og software' WHERE `group_name` = '' AND `number` = 2000;--> statement-breakpoint
UPDATE `account` SET `group_name` = 'Kontor og lokaler' WHERE `group_name` = '' AND `number` = 2100;--> statement-breakpoint
UPDATE `account` SET `group_name` = 'Salg og repræsentation' WHERE `group_name` = '' AND `number` IN (2200, 2600);--> statement-breakpoint
UPDATE `account` SET `group_name` = 'Rejser og transport' WHERE `group_name` = '' AND `number` = 2300;--> statement-breakpoint
UPDATE `account` SET `group_name` = 'Administration' WHERE `group_name` = '' AND `number` IN (2400, 2500);--> statement-breakpoint
UPDATE `account` SET `group_name` = 'Øvrige' WHERE `group_name` = '' AND `number` = 2900;--> statement-breakpoint
-- The expanded default kontoplan. INSERT OR IGNORE: a number the owner already uses keeps the owner's account.
-- No explicit ids (the 0006 rows own 1..11); nothing references these rows yet, so they can be deleted again.
INSERT OR IGNORE INTO `account` (`number`, `name`, `type`, `group_name`) VALUES
  (1300, 'Salg til EU-kunder (omvendt betalingspligt)', 'revenue', 'Omsætning'),
  (1400, 'Salg uden for EU', 'revenue', 'Omsætning'),
  (1500, 'Viderefakturerede udlæg', 'revenue', 'Omsætning'),
  (2050, 'Hardware og IT-udstyr', 'cost', 'IT og software'),
  (2110, 'Husleje og kontorplads', 'cost', 'Kontor og lokaler'),
  (2120, 'Telefon og internet', 'cost', 'Kontor og lokaler'),
  (2130, 'Inventar og småanskaffelser', 'cost', 'Kontor og lokaler'),
  (2310, 'Kørselsgodtgørelse', 'cost', 'Rejser og transport'),
  (2550, 'Faglitteratur og abonnementer', 'cost', 'Administration'),
  (3000, 'Underleverandører og freelancere', 'cost', 'Direkte omkostninger'),
  (3100, 'Varekøb og materialer', 'cost', 'Direkte omkostninger'),
  (3200, 'Udlæg for kunder', 'cost', 'Direkte omkostninger'),
  (4000, 'Løn', 'cost', 'Personale'),
  (4100, 'Pension og sociale bidrag', 'cost', 'Personale'),
  (4200, 'Kurser og uddannelse', 'cost', 'Personale'),
  (7000, 'Renteudgifter', 'cost', 'Afskrivninger og finansielle poster'),
  (7100, 'Gebyrer (bank og betaling)', 'cost', 'Afskrivninger og finansielle poster'),
  (7500, 'Afskrivninger', 'cost', 'Afskrivninger og finansielle poster');
