/**
 * Migrations must apply to a POPULATED database, not only an empty one: the
 * invoice table is rebuilt by 0001 while invoice_line rows reference it.
 * Builds a 0000-schema database with data, marks 0000 as applied the way the
 * drizzle migrator does, then boots the app's db module (which migrates).
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dataDir: string;

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faktura-migrate-'));
  const dbPath = path.join(dataDir, 'app.db');
  const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string; when: number }[] };
  const first = journal.entries[0];
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  for (const stmt of fs.readFileSync(`drizzle/${first.tag}.sql`, 'utf8').split('--> statement-breakpoint')) {
    if (stmt.trim()) sqlite.exec(stmt);
  }
  sqlite.exec('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  sqlite.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run('fixture', first.when);
  sqlite.exec(`
    INSERT INTO customer (id, name, address, zip, city, country, email, created_at) VALUES (1, 'K', 'A 1', '1000', 'By', 'DK', '', '2026-01-01T00:00:00Z');
    INSERT INTO invoice (id, invoice_number, status, customer_id, issue_date, due_date, subtotal_ore, vat_ore, total_ore, payment_reference, pdf_path, created_at)
      VALUES (1, 1001, 'issued', 1, '2026-04-14', '2026-04-28', 10000, 2500, 12500, 'Reg. 1 Konto 2', 'files/invoices/1001.pdf', '2026-04-14T00:00:00Z');
    INSERT INTO invoice (id, status, customer_id, issue_date, due_date, created_at) VALUES (2, 'draft', 1, '2026-09-01', '2026-09-15', '2026-09-01T00:00:00Z');
    INSERT INTO invoice_line (invoice_id, description, quantity, unit, unit_price_ore, line_total_ore) VALUES (1, 'X', 1, 'stk.', 10000, 10000), (2, 'Y', 2, 'stk.', 100, 200);
    INSERT INTO expense (voucher_number, date, supplier, description, category, amount_ex_vat_ore, vat_ore, amount_incl_ore, created_at) VALUES (1, '2026-04-02', 'S', 'D', 'C', 100, 25, 125, '2026-04-02T00:00:00Z');
    INSERT INTO audit_log (timestamp, entity, entity_id, action, detail_json) VALUES ('2026-04-14T00:00:00Z', 'invoice', 1, 'issue', '{}');
  `);
  sqlite.close();
  process.env.DATA_DIR = dataDir;
  process.env.APP_PASSWORD = 'x';
  process.env.PROJECT_ROOT = process.cwd();
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('migrating a populated database', () => {
  it('applies all later migrations without losing rows and leaves FK integrity intact', async () => {
    const { sqlite } = await import('../../src/lib/server/db');
    try {
      const count = (t: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
      expect(count('invoice')).toBe(2);
      expect(count('invoice_line')).toBe(2);
      expect(count('expense')).toBe(1);
      expect(count('audit_log')).toBe(1);
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
      // Accounts were seeded by migration 0006 and existing rows got the defaults.
      expect((sqlite.prepare('SELECT count(*) AS n FROM account').get() as { n: number }).n).toBe(11);
      expect(sqlite.prepare('SELECT account_id FROM expense WHERE voucher_number = 1').get()).toEqual({ account_id: 11 });
      expect(sqlite.prepare('SELECT account_id FROM invoice_line WHERE invoice_id = 1').get()).toEqual({ account_id: 1 });
      expect((sqlite.prepare("SELECT count(*) AS n FROM pragma_table_info('expense') WHERE name = 'category'").get() as { n: number }).n).toBe(0);
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      const triggers = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]).map((t) => t.name);
      const { REQUIRED_TRIGGERS } = await import('../../src/lib/server/db');
      for (const t of REQUIRED_TRIGGERS) expect(triggers).toContain(t);
      expect(REQUIRED_TRIGGERS.length).toBe(12);
      // Guards are live on the migrated data too.
      expect(() => sqlite.prepare('DELETE FROM invoice WHERE id = 1').run()).toThrow(/cannot be deleted/);
      expect(() => sqlite.prepare('DELETE FROM invoice_line WHERE invoice_id = 2').run()).not.toThrow();
    } finally {
      sqlite.close();
    }
  });
});
