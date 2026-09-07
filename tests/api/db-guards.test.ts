/**
 * Proves the "no SQL path" rules at the database level: even raw SQL that
 * bypasses the services cannot delete or alter issued invoices, alter their
 * lines, or touch audit_log rows.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dataDir: string;
let sqlite: import('better-sqlite3').Database;
let issuedId: number;
let closeBrowser: () => Promise<void>;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faktura-guards-'));
  process.env.DATA_DIR = dataDir;
  process.env.APP_PASSWORD = 'x';
  process.env.PROJECT_ROOT = process.cwd();
  const db = await import('../../src/lib/server/db');
  sqlite = db.sqlite;
  const { updateSettings } = await import('../../src/lib/server/services/settings');
  const { createCustomer } = await import('../../src/lib/server/services/customers');
  const { createDraft, updateDraft, issueInvoice } = await import('../../src/lib/server/services/invoices');
  closeBrowser = (await import('../../src/lib/server/pdf')).closeBrowser;

  await updateSettings({
    company_name: 'Guard ApS', company_address: 'Vej 1', company_zip: '1000', company_city: 'København K',
    company_cvr: '12345678', bank_reg: '1234', bank_account: '1234567890'
  });
  const c = createCustomer({ name: 'K', address: 'A 1', zip: '1000', city: 'By', email: '' });
  const d = createDraft({ customerId: c.id });
  await updateDraft(d.id, {
    customerId: c.id, issueDate: '2026-09-01', dueDate: '2026-09-15', paymentReference: 'Reg. 1234 Konto 1234567890',
    lines: [{ description: 'X', quantity: 1, unit: 'stk.', unitPriceOre: 10000 }]
  });
  issuedId = (await issueInvoice(d.id)).id;
});

afterAll(async () => {
  await closeBrowser();
  sqlite.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('database guards', () => {
  it('refuses to delete an issued invoice', () => {
    expect(() => sqlite.prepare('DELETE FROM invoice WHERE id = ?').run(issuedId)).toThrow(/cannot be deleted/);
    expect(sqlite.prepare('SELECT status FROM invoice WHERE id = ?').get(issuedId)).toEqual({ status: 'issued' });
  });

  it('refuses to change the content or number of an issued invoice, but allows paid_date', () => {
    expect(() => sqlite.prepare('UPDATE invoice SET total_ore = 1 WHERE id = ?').run(issuedId)).toThrow(/immutable/);
    expect(() => sqlite.prepare('UPDATE invoice SET invoice_number = 9999 WHERE id = ?').run(issuedId)).toThrow(/immutable/);
    expect(() => sqlite.prepare("UPDATE invoice SET status = 'draft' WHERE id = ?").run(issuedId)).toThrow(/immutable/);
    expect(() => sqlite.prepare("UPDATE invoice SET pdf_path = 'x' WHERE id = ?").run(issuedId)).toThrow(/immutable/);
    expect(() => sqlite.prepare("UPDATE invoice SET paid_date = '2026-09-02' WHERE id = ?").run(issuedId)).not.toThrow();
  });

  it('refuses to insert, update or delete lines of an issued invoice', () => {
    expect(() => sqlite.prepare('UPDATE invoice_line SET line_total_ore = 1 WHERE invoice_id = ?').run(issuedId)).toThrow(/immutable/);
    expect(() => sqlite.prepare('DELETE FROM invoice_line WHERE invoice_id = ?').run(issuedId)).toThrow(/immutable/);
    expect(() =>
      sqlite
        .prepare("INSERT INTO invoice_line (invoice_id, description, quantity, unit, unit_price_ore, line_total_ore) VALUES (?, 'y', 1, 'stk.', 1, 1)")
        .run(issuedId)
    ).toThrow(/immutable/);
  });

  it('credited_by_invoice_id cannot be set, cleared or repointed by raw SQL', () => {
    expect(() => sqlite.prepare('UPDATE invoice SET credited_by_invoice_id = 1 WHERE id = ?').run(issuedId)).toThrow(/immutable/);
    expect(() =>
      sqlite
        .prepare("INSERT INTO invoice (status, customer_id, issue_date, due_date, credited_by_invoice_id, created_at) VALUES ('draft', 1, '2026-09-01', '2026-09-15', ?, 'x')")
        .run(issuedId)
    ).toThrow(/crediting only/);
    expect(() => sqlite.prepare("UPDATE invoice SET status = 'credited' WHERE id = ?").run(issuedId)).toThrow(/immutable|issued credit note/);
    expect(() => sqlite.prepare("UPDATE invoice SET status = 'bogus' WHERE id = ?").run(issuedId)).toThrow(/immutable|invalid/);
    // A draft cannot pre-set the link, and the link can never point at a draft or at the row itself.
    const draft = sqlite
      .prepare("INSERT INTO invoice (status, customer_id, issue_date, due_date, created_at) VALUES ('draft', 1, '2026-09-01', '2026-09-15', 'x') RETURNING id")
      .get() as { id: number };
    expect(() => sqlite.prepare('UPDATE invoice SET credited_by_invoice_id = ? WHERE id = ?').run(issuedId, draft.id)).toThrow(/crediting only/);
    expect(() => sqlite.prepare("UPDATE invoice SET status = 'credited', credited_by_invoice_id = ? WHERE id = ?").run(draft.id, issuedId)).toThrow(/issued credit note/);
    expect(() => sqlite.prepare("UPDATE invoice SET status = 'credited', credited_by_invoice_id = id WHERE id = ?").run(issuedId)).toThrow(/issued credit note/);
    sqlite.prepare('DELETE FROM invoice WHERE id = ?').run(draft.id);
  });

  it('audit_log is append-only', () => {
    const row = sqlite.prepare('SELECT id FROM audit_log ORDER BY id LIMIT 1').get() as { id: number };
    expect(() => sqlite.prepare("UPDATE audit_log SET action = 'tampered' WHERE id = ?").run(row.id)).toThrow(/append-only/);
    expect(() => sqlite.prepare('DELETE FROM audit_log WHERE id = ?').run(row.id)).toThrow(/append-only/);
  });

  it('WAL mode is on', () => {
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});
