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

  it('two originals can never share one credit note', () => {
    // Raw issued rows (no lines needed) so the constraint is exercised directly.
    const ins = sqlite.prepare(
      "INSERT INTO invoice (invoice_number, status, customer_id, issue_date, due_date, payment_reference, created_at) VALUES (?, 'issued', 1, '2026-09-01', '2026-09-15', 'x', 'x') RETURNING id"
    );
    const note = (ins.get(990001) as { id: number }).id;
    const a = (ins.get(990002) as { id: number }).id;
    const b = (ins.get(990003) as { id: number }).id;
    const credit = sqlite.prepare("UPDATE invoice SET status = 'credited', credited_by_invoice_id = ? WHERE id = ?");
    expect(() => credit.run(note, a)).not.toThrow();
    expect(() => credit.run(note, b)).toThrow(/UNIQUE constraint failed: invoice.credited_by_invoice_id/);
  });

  it('cash movements are append-only', () => {
    const id = (sqlite.prepare("INSERT INTO cash_movement (date, description, amount_ore, kind, created_at) VALUES ('2026-09-01', 'x', -100, 'other', 'x') RETURNING id").get() as { id: number }).id;
    expect(() => sqlite.prepare('UPDATE cash_movement SET amount_ore = -1 WHERE id = ?').run(id)).toThrow(/append-only/);
    expect(() => sqlite.prepare('DELETE FROM cash_movement WHERE id = ?').run(id)).toThrow(/append-only/);
  });

  it('accounts can only be renamed', () => {
    expect(() => sqlite.prepare("UPDATE account SET type = 'cost' WHERE number = 1000").run()).toThrow(/renamed/);
    expect(() => sqlite.prepare('UPDATE account SET number = 1001 WHERE number = 1000').run()).toThrow(/renamed/);
    expect(() => sqlite.prepare("UPDATE account SET name = 'Konsulentydelser' WHERE number = 1000").run()).not.toThrow();
  });

  it('audit_log is append-only', () => {
    const row = sqlite.prepare('SELECT id FROM audit_log ORDER BY id LIMIT 1').get() as { id: number };
    expect(() => sqlite.prepare("UPDATE audit_log SET action = 'tampered' WHERE id = ?").run(row.id)).toThrow(/append-only/);
    expect(() => sqlite.prepare('DELETE FROM audit_log WHERE id = ?').run(row.id)).toThrow(/append-only/);
  });

  it('sent_at is written once, on issued documents only', () => {
    const draft = sqlite
      .prepare("INSERT INTO invoice (status, customer_id, issue_date, due_date, created_at) VALUES ('draft', 1, '2026-09-01', '2026-09-15', 'x') RETURNING id")
      .get() as { id: number };
    expect(() => sqlite.prepare("UPDATE invoice SET sent_at = '2026-09-02' WHERE id = ?").run(draft.id)).toThrow(/set once/);
    sqlite.prepare('DELETE FROM invoice WHERE id = ?').run(draft.id);
    expect(() => sqlite.prepare("UPDATE invoice SET sent_at = '2026-09-02' WHERE id = ?").run(issuedId)).not.toThrow();
    expect(() => sqlite.prepare("UPDATE invoice SET sent_at = '2026-09-03' WHERE id = ?").run(issuedId)).toThrow(/set once/);
    expect(() => sqlite.prepare('UPDATE invoice SET sent_at = NULL WHERE id = ?').run(issuedId)).toThrow(/set once/);
    expect(sqlite.prepare('SELECT sent_at FROM invoice WHERE id = ?').get(issuedId)).toEqual({ sent_at: '2026-09-02' });
  });

  it('attachments of an issued invoice cannot be added, changed or removed', () => {
    const ins = sqlite.prepare(
      "INSERT INTO invoice_attachment (invoice_id, position, name, file_path, pages, size_bytes, created_at) VALUES (?, 1, 'x.pdf', 'files/invoices/bilag/x.pdf', 1, 10, 'x')"
    );
    expect(() => ins.run(issuedId)).toThrow(/immutable/);
    // Attach to a draft, issue-like flip is blocked by other guards, so simulate: attach then try to touch after the row's invoice is issued.
    const draft = sqlite
      .prepare("INSERT INTO invoice (status, customer_id, issue_date, due_date, created_at) VALUES ('draft', 1, '2026-09-01', '2026-09-15', 'x') RETURNING id")
      .get() as { id: number };
    expect(() => ins.run(draft.id)).not.toThrow();
    sqlite.prepare("UPDATE invoice SET status = 'issued', invoice_number = 990010, pdf_path = 'files/invoices/990010.pdf' WHERE id = ?").run(draft.id);
    expect(() => sqlite.prepare("UPDATE invoice_attachment SET name = 'y.pdf' WHERE invoice_id = ?").run(draft.id)).toThrow(/immutable/);
    expect(() => sqlite.prepare('DELETE FROM invoice_attachment WHERE invoice_id = ?').run(draft.id)).toThrow(/immutable/);
  });

  it('WAL mode is on', () => {
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});
