import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { Client, loggedIn } from './client';

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

describe('export zip', () => {
  it('contains the ten CSVs and every file under /data/files/', async () => {
    const r = await c.raw('GET', '/api/export');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/zip');
    const zip = new AdmZip(Buffer.from(await r.arrayBuffer()));
    const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));

    for (const csv of ['invoices.csv', 'invoice_lines.csv', 'invoice_attachments.csv', 'customers.csv', 'expenses.csv', 'cash_movements.csv', 'accounts.csv', 'settings.csv', 'audit_log.csv', 'posteringer.csv']) {
      expect(names).toContain(csv);
    }

    const filesDir = path.join(inject('dataDir'), 'files');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]
      );
    const onDisk = walk(filesDir).map((p) => 'files/' + path.relative(filesDir, p).replace(/\\/g, '/'));
    expect(onDisk.length).toBeGreaterThan(10);
    for (const f of onDisk) expect(names, f).toContain(f);

    // CSV format: UTF-8, semicolon separated, Danish decimal comma
    const invoices = zip.readAsText('invoices.csv').replace(/^\uFEFF/, '');
    const [header, ...rows] = invoices.trim().split(/\r?\n/);
    expect(header.split(';')).toContain('fakturanr');
    expect(header.split(';')).toContain('total_inkl_moms');
    const row1001 = rows.find((l) => l.split(';')[1] === '1001')!;
    expect(row1001).toBeDefined();
    const cols = row1001.split(';');
    expect(cols[header.split(';').indexOf('total_inkl_moms')]).toBe('58500,00');
    expect(cols[header.split(';').indexOf('kunde')]).toBe('Nordhavn Arkitekter ApS');

    const expenses = zip.readAsText('expenses.csv').replace(/^\uFEFF/, '');
    expect(expenses).toContain('2200;Repræsentation');
    expect(expenses).toContain('74,75');
    const lines = zip.readAsText('invoice_lines.csv').replace(/^\uFEFF/, '');
    expect(lines.split(/\r?\n/)[0].split(';')).toEqual(expect.arrayContaining(['konto', 'kontonavn']));
    expect(lines).toContain(';1200;Momsfrit salg');
    const movements = zip.readAsText('cash_movements.csv').replace(/^\uFEFF/, '');
    expect(movements).toContain(';-14550,25;vat_payment;');
    const accounts = zip.readAsText('accounts.csv').replace(/^\uFEFF/, '');
    expect(accounts.trim().split(/\r?\n/).length).toBeGreaterThanOrEqual(12);
    expect(accounts).toContain('1000;Konsulentydelser;salg');

    const audit = zip.readAsText('audit_log.csv').replace(/^\uFEFF/, '');
    expect(audit).toContain(';issue;');
    expect(audit).toContain(';issue_credit_note;');
    expect(audit).toContain(';upload;');
    expect(audit).toContain(';cash_movement;');
  });
});
