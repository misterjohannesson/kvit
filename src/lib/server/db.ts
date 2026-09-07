import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
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

// Migrations that rebuild a table (drizzle's SQLite "recreate" pattern) drop and
// re-create it while other tables still reference it. The migrator runs inside
// one transaction, where `PRAGMA foreign_keys=OFF` is a no-op, so enforcement is
// switched off around the whole run and integrity is verified afterwards.
sqlite.pragma('foreign_keys = OFF');
migrate(db, { migrationsFolder: path.join(PROJECT_ROOT, 'drizzle') });
const violations = sqlite.pragma('foreign_key_check') as unknown[];
if (violations.length > 0) {
  throw new Error(`Database integrity check failed after migration: ${JSON.stringify(violations.slice(0, 5))}`);
}
sqlite.pragma('foreign_keys = ON');

// Seed default settings once (INSERT OR IGNORE keeps existing values).
const insertSetting = sqlite.prepare('INSERT OR IGNORE INTO setting (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertSetting.run(key, value);
}

export { schema };
