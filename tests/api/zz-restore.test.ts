/**
 * Restore from an export zip. Runs last (zz-): it replaces the whole data set, then verifies the app still holds
 * the same books, the previous data sits in backups/data.bak01/, and the guard triggers are back. A second pass
 * applies an accountant-style correction made in the CSVs.
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { Client, loggedIn } from './client';

let c: Client;
let exportZip: Buffer;

type Summary = { id: string; counts: Record<string, { file: number; current: number }>; files: { inZip: number; current: number; missing: string[] }; warnings: string[]; backupDir: string; invoiceRange: { first: number | null; last: number | null } };

async function stage(bytes: Buffer, name = 'eksport.zip') {
  const fd = new FormData();
  fd.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), name);
  const r = await c.raw('POST', '/api/restore', fd);
  const text = await r.text();
  return { status: r.status, data: (text ? JSON.parse(text) : null) as Summary & { error?: string } };
}

function edited(bytes: Buffer, edit: (zip: AdmZip) => void): Buffer {
  const zip = new AdmZip(bytes);
  edit(zip);
  return zip.toBuffer();
}

const csv = (zip: AdmZip, name: string) => zip.readAsText(name).replace(/^﻿/, '');
const setCsv = (zip: AdmZip, name: string, text: string) => {
  zip.deleteFile(name);
  zip.addFile(name, Buffer.from('﻿' + text, 'utf8'));
};

beforeAll(async () => {
  c = await loggedIn();
  const r = await c.raw('GET', '/api/export');
  exportZip = Buffer.from(await r.arrayBuffer());
});

describe('restore from export', () => {
  it('the export carries what a restore needs: customers, settings, attachments, the audit actor and a balanced journal', () => {
    const zip = new AdmZip(exportZip);
    const names = zip.getEntries().map((e) => e.entryName);
    for (const f of ['customers.csv', 'settings.csv', 'invoice_attachments.csv', 'posteringer.csv']) expect(names).toContain(f);
    expect(csv(zip, 'audit_log.csv').split(/\r?\n/)[0]).toContain('aktoer');
    expect(csv(zip, 'settings.csv')).toContain('next_invoice_number;');
    expect(csv(zip, 'settings.csv')).toContain('bal_bank_number;5820');
    // posteringer.csv: every postering balances, the bank account carries the opening balance, kontoplan accounts appear.
    const [header, ...rows] = csv(zip, 'posteringer.csv').trim().split('\r\n');
    const cols = header.split(';');
    const col = (r: string[], n: string) => r[cols.indexOf(n)];
    const ore = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
    const byEntry = new Map<string, number>();
    let debit = 0;
    let credit = 0;
    for (const line of rows) {
      const r = line.split(';');
      const d = ore(col(r, 'debet'));
      const k = ore(col(r, 'kredit'));
      debit += d;
      credit += k;
      byEntry.set(col(r, 'postering'), (byEntry.get(col(r, 'postering')) ?? 0) + d - k);
    }
    expect(debit).toBeGreaterThan(0);
    expect(debit).toBe(credit);
    for (const [entry, sum] of byEntry) expect(sum, `postering ${entry}`).toBe(0);
    const types = new Set(rows.map((l) => col(l.split(';'), 'bilagstype')));
    for (const t of ['bankbevægelse', 'betaling', 'faktura', 'indbetaling', 'kreditnota', 'udgift', 'åbningssaldo']) expect(types, t).toContain(t);
    expect(rows.some((l) => l.includes(';5820;Bank;') && col(l.split(';'), 'bilagstype') === 'åbningssaldo')).toBe(true);
    expect(rows.some((l) => l.includes(';1000;Konsulentydelser;'))).toBe(true);
    expect(rows.some((l) => l.includes(';6902;Udgående moms;'))).toBe(true);
  });

  it('stages an unchanged export, describes it, and applying it keeps the books identical with a backup on disk', async () => {
    const before = {
      invoices: (await c.json('GET', '/api/invoices')).data,
      expenses: (await c.json('GET', '/api/expenses?year=2026')).data,
      balance: (await c.json('GET', '/api/finance?view=balance')).data,
      audit: (await c.json<unknown[]>('GET', '/api/audit?limit=500')).data
    };
    const staged = await stage(exportZip, 'faktura-eksport.zip');
    expect(staged.status, JSON.stringify(staged.data)).toBe(201);
    const s = staged.data;
    expect(s.counts.invoices.file).toBe(s.counts.invoices.current);
    expect(s.counts.expenses.file).toBe(s.counts.expenses.current);
    expect(s.files.inZip).toBe(s.files.current);
    expect(s.files.missing).toEqual([]);
    expect(s.invoiceRange.first).toBe(1001);
    expect(s.invoiceRange.last).toBeGreaterThanOrEqual(1006); // earlier test files issue more documents
    expect(s.backupDir.replace(/\\/g, '/')).toMatch(/backups\/data\.bak01$/);
    // The summary can be fetched again, and applying needs the explicit confirm.
    expect((await c.json('GET', `/api/restore/${s.id}`)).status).toBe(200);
    expect((await c.json('POST', `/api/restore/${s.id}`, {})).status).toBe(400);
    expect((await c.json('POST', '/api/restore/000000000000000000000000', { confirm: true })).status).toBe(404);

    const applied = await c.json<{ backupDir: string; counts: Record<string, number>; files: number }>('POST', `/api/restore/${s.id}`, { confirm: true });
    expect(applied.status, JSON.stringify(applied.data)).toBe(200);
    expect(applied.data.counts.invoices).toBe(s.counts.invoices.file);

    // The books read the same through the API.
    expect((await c.json('GET', '/api/invoices')).data).toEqual(before.invoices);
    expect((await c.json('GET', '/api/expenses?year=2026')).data).toEqual(before.expenses);
    expect((await c.json('GET', '/api/finance?view=balance')).data).toEqual(before.balance);
    // The restored audit log is exactly the exported one plus the restore row (the export's own row and the staging
    // row were written after the CSV was built, so they belong to the replaced set and live on in the backup copy).
    const audit = (await c.json<{ action: string; entity: string }[]>('GET', '/api/audit?limit=500')).data;
    expect(audit[0]).toMatchObject({ entity: 'data', action: 'restore' });
    const exportedRows = csv(new AdmZip(exportZip), 'audit_log.csv').trim().split('\r\n').length - 1;
    expect(audit.length).toBe(exportedRows + 1);
    expect(before.audit.length).toBeGreaterThanOrEqual(exportedRows);
    // Files came back: the issued PDF is served, and the seed's files are all on disk.
    const pdf = await c.raw('GET', `/api/invoices/${(before.invoices as { id: number; invoiceNumber: number }[]).find((i) => i.invoiceNumber === 1001)!.id}/pdf`);
    expect(pdf.status).toBe(200);
    const dataDir = inject('dataDir');
    expect(fs.existsSync(path.join(dataDir, 'files', 'invoices', '1001.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'files.restore-new'))).toBe(false);
    // The previous data is in the backup directory: database, files and the applied zip.
    const backup = path.join(dataDir, 'backups', 'data.bak01');
    expect(fs.existsSync(path.join(backup, 'app.db'))).toBe(true);
    expect(fs.existsSync(path.join(backup, 'files', 'invoices', '1001.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(backup, 'import.zip'))).toBe(true);
    expect(fs.readdirSync(path.join(dataDir, 'restore'))).toEqual([]);
    // Guard triggers are back: an issued invoice still cannot be deleted, and the number series continues.
    const issued = (before.invoices as { id: number; status: string }[]).find((i) => i.status === 'issued')!;
    expect((await c.json('DELETE', `/api/invoices/${issued.id}`)).status).toBe(409);
    expect(Number((await c.json<{ next_invoice_number: string }>('GET', '/api/settings')).data.next_invoice_number)).toBeGreaterThan(s.invoiceRange.last!);
  });

  it('applies an accountant\'s correction in the CSVs (renamed customer, re-booked expense, edited settings)', async () => {
    const fixed = edited(exportZip, (zip) => {
      setCsv(zip, 'customers.csv', csv(zip, 'customers.csv').replace('Nordhavn Arkitekter ApS', 'Nordhavn Arkitekter A/S'));
      // Voucher 1 (mobile subscription) moves from 2900 Øvrige to 2100 Kontorhold; the account column is what counts.
      const expenses = csv(zip, 'expenses.csv').split('\r\n');
      const header = expenses[0].split(';');
      const iKonto = header.indexOf('konto');
      const iNavn = header.indexOf('kontonavn');
      const iBilag = header.indexOf('bilagsnr');
      const rows = expenses.map((l, n) => {
        if (n === 0) return l;
        const cells = l.split(';');
        if (cells[iBilag] === '1') {
          cells[iKonto] = '2100';
          cells[iNavn] = 'ignoreret';
        }
        return cells.join(';');
      });
      setCsv(zip, 'expenses.csv', rows.join('\r\n'));
      setCsv(zip, 'settings.csv', csv(zip, 'settings.csv').replace('bal_bank_number;5820', 'bal_bank_number;5810'));
    });
    const staged = await stage(fixed);
    expect(staged.status, JSON.stringify(staged.data)).toBe(201);
    expect(staged.data.backupDir.replace(/\\/g, '/')).toMatch(/data\.bak02$/);
    const applied = await c.json('POST', `/api/restore/${staged.data.id}`, { confirm: true });
    expect(applied.status).toBe(200);
    const customers = (await c.json<{ name: string }[]>('GET', '/api/customers')).data;
    expect(customers.some((x) => x.name === 'Nordhavn Arkitekter A/S')).toBe(true);
    const voucher1 = (await c.json<{ voucherNumber: number; accountId: number }[]>('GET', '/api/expenses?year=2026')).data.find((e) => e.voucherNumber === 1)!;
    const accounts = (await c.json<{ id: number; number: number }[]>('GET', '/api/accounts')).data;
    expect(accounts.find((a) => a.id === voucher1.accountId)?.number).toBe(2100);
    expect((await c.json<{ bal_bank_number: string }>('GET', '/api/settings')).data.bal_bank_number).toBe('5810');
    const r = await c.raw('GET', '/api/export');
    const zip = new AdmZip(Buffer.from(await r.arrayBuffer()));
    expect(csv(zip, 'posteringer.csv')).toContain(';5810;Bank;');
  });

  it('refuses a zip whose figures do not add up, and nothing changes', async () => {
    const countBefore = (await c.json<unknown[]>('GET', '/api/invoices')).data.length;
    const cases: [string, (zip: AdmZip) => void, RegExp][] = [
      ['totals off', (zip) => setCsv(zip, 'invoices.csv', csv(zip, 'invoices.csv').replace(';58500,00;', ';58500,01;')), /passer ikke til linjerne/],
      ['unknown customer', (zip) => setCsv(zip, 'invoices.csv', csv(zip, 'invoices.csv').replace(/\r\n(\d+);1001;issued;(\d+);/, (_m, id) => `\r\n${id};1001;issued;999;`)), /kunde_id 999 findes ikke/],
      ['duplicate number', (zip) => setCsv(zip, 'invoices.csv', csv(zip, 'invoices.csv').replace(';1002;', ';1001;')), /fakturanr 1001 findes også/],
      ['unknown account on a line', (zip) => setCsv(zip, 'invoice_lines.csv', csv(zip, 'invoice_lines.csv').replace(';1200;Momsfrit salg', ';1299;Momsfrit salg')), /konto 1299 findes ikke/],
      ['bad amount format', (zip) => setCsv(zip, 'expenses.csv', csv(zip, 'expenses.csv').replace(';299,00;', ';abc;')), /er ikke et beløb/],
      ['no customers file', (zip) => zip.deleteFile('customers.csv'), /customers.csv/],
      ['next number too low', (zip) => setCsv(zip, 'settings.csv', csv(zip, 'settings.csv').replace(/next_invoice_number;\d+/, 'next_invoice_number;1003')), /next_invoice_number/]
    ];
    for (const [label, edit, pattern] of cases) {
      const r = await stage(edited(exportZip, edit));
      expect(r.status, label).toBe(400);
      expect(r.data.error, label).toMatch(pattern);
    }
    expect((await stage(Buffer.from('not a zip'))).data.error).toMatch(/ikke en zip/);
    expect((await c.json<unknown[]>('GET', '/api/invoices')).data.length).toBe(countBefore);
    expect(fs.readdirSync(path.join(inject('dataDir'), 'restore'))).toEqual([]);
  });

  it('stages through the page, warns about a missing file, and discards without applying', async () => {
    const withoutPdf = edited(exportZip, (zip) => zip.deleteFile('files/invoices/1001.pdf'));
    const fd = new FormData();
    fd.set('file', new Blob([new Uint8Array(withoutPdf)]), 'ret.zip');
    const page = await c.raw('POST', '/eksport?/stage', fd, { accept: 'text/html' });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Erstat alle data');
    expect(html).toContain('files/invoices/1001.pdf');
    const id = /name="id" value="([0-9a-f]{24})"/.exec(html)?.[1] ?? /name=&quot;id&quot; value=&quot;([0-9a-f]{24})/.exec(html)?.[1];
    expect(id, html.slice(0, 200)).toBeTruthy();
    expect((await c.json('DELETE', `/api/restore/${id}`)).status).toBe(200);
    expect((await c.json('GET', `/api/restore/${id}`)).status).toBe(404);
    expect(fs.existsSync(path.join(inject('dataDir'), 'files', 'invoices', '1001.pdf'))).toBe(true);
  });
});
