import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { DATA_DIR, DB_PATH, EXPENSE_FILES_DIR, INVOICE_FILES_DIR, PROJECT_ROOT } from './env';
import { DEFAULT_SETTINGS } from './services/settings-defaults';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(INVOICE_FILES_DIR, { recursive: true });
fs.mkdirSync(EXPENSE_FILES_DIR, { recursive: true });

export const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });

/**
 * The guard triggers that make the audit spine hold at the database level.
 * A future migration that rebuilds `invoice` (drizzle's recreate pattern) drops
 * the triggers on it together with the table; the assertion below turns that
 * into a loud startup failure instead of a silent loss of protection.
 */
export const REQUIRED_TRIGGERS = [
  'audit_log_no_update',
  'audit_log_no_delete',
  'invoice_no_delete_issued',
  'invoice_immutable_issued',
  'invoice_status_values_insert',
  'invoice_status_values_update',
  'invoice_line_no_insert_issued',
  'invoice_line_no_update_issued',
  'invoice_line_no_delete_issued',
  'invoice_credited_by_insert',
  'invoice_credited_by_draft',
  'invoice_credited_by_target',
  'cash_movement_no_update',
  'cash_movement_no_delete',
  'account_identity_immutable'
] as const;

// Migrations that rebuild a table drop and re-create it while other tables (and
// triggers) still reference it. The migrator runs inside one transaction, where
// `PRAGMA foreign_keys=OFF` is a no-op, so enforcement is switched off around the
// whole run and integrity is verified afterwards. legacy_alter_table keeps the
// rename from rewriting references inside other tables' triggers.
sqlite.pragma('foreign_keys = OFF');
sqlite.pragma('legacy_alter_table = ON');
migrate(db, { migrationsFolder: path.join(PROJECT_ROOT, 'drizzle') });
sqlite.pragma('legacy_alter_table = OFF');
const violations = sqlite.pragma('foreign_key_check') as unknown[];
if (violations.length > 0) {
  throw new Error(`Database integrity check failed after migration: ${JSON.stringify(violations.slice(0, 5))}`);
}
sqlite.pragma('foreign_keys = ON');

const presentTriggers = new Set(
  (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]).map((t) => t.name)
);
const missingTriggers = REQUIRED_TRIGGERS.filter((t) => !presentTriggers.has(t));
if (missingTriggers.length > 0) {
  throw new Error(
    `Database guard triggers missing after migration: ${missingTriggers.join(', ')}. ` +
      'A migration that rebuilt a table must re-create its triggers.'
  );
}

// Seed default settings once (INSERT OR IGNORE keeps existing values).
const insertSetting = sqlite.prepare('INSERT OR IGNORE INTO setting (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertSetting.run(key, value);
}

/** Row count of a table (dashboard/nav counters). */
export function countRows(table: schema.AnyTable): number {
  return db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;
}

export { schema };
