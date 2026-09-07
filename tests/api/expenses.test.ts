import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { Client, loggedIn } from './client';

type Exp = {
  id: number;
  voucherNumber: number;
  amountExVatOre: number;
  vatOre: number;
  amountInclOre: number;
  filePath: string | null;
};

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('expenses', () => {
  it('seed created vouchers 1..8 with files', async () => {
    const list = await c.json<Exp[]>('GET', '/api/expenses');
    const vouchers = list.data.map((e) => e.voucherNumber).sort((a, b) => a - b);
    expect(vouchers.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const e of list.data.filter((e) => e.voucherNumber <= 8)) {
      expect(e.filePath).toMatch(new RegExp(`^files/expenses/${e.voucherNumber}\\.(pdf|jpg|png)$`));
      expect(fs.existsSync(path.join(inject('dataDir'), e.filePath as string))).toBe(true);
    }
  });

  it('assigns the next voucher number on create, keeps VAT as entered and derives the incl. amount', async () => {
    const list = await c.json<Exp[]>('GET', '/api/expenses');
    const max = Math.max(...list.data.map((e) => e.voucherNumber));
    const r = await c.json<Exp>('POST', '/api/expenses', {
      date: '2026-09-05',
      supplier: 'Udenlandsk leverandør',
      description: 'SaaS',
      category: 'Software',
      amountExVatOre: 10000,
      vatOre: 0
    });
    expect(r.status).toBe(201);
    expect(r.data.voucherNumber).toBe(max + 1);
    expect(r.data.vatOre).toBe(0);
    expect(r.data.amountInclOre).toBe(10000);
    expect(r.data.filePath).toBeNull();

    const fd = new FormData();
    fd.set('file', new Blob([PNG], { type: 'image/png' }), 'kvittering.png');
    const up = await c.raw('POST', `/api/expenses/${r.data.id}/file`, fd);
    expect(up.status).toBe(200);
    const upd = (await up.json()) as Exp;
    expect(upd.filePath).toBe(`files/expenses/${max + 1}.png`);

    const file = await c.raw('GET', `/api/expenses/${r.data.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('accepts multipart create with Danish amounts and a file', async () => {
    const fd = new FormData();
    fd.set('date', '2026-09-06');
    fd.set('supplier', 'Café');
    fd.set('description', 'Møde');
    fd.set('category', 'Repræsentation');
    fd.set('amountExVat', '1.000,00');
    fd.set('vat', '62,50');
    fd.set('file', new Blob([PNG], { type: 'image/png' }), 'bon.png');
    const r = await c.raw('POST', '/api/expenses', fd);
    expect(r.status).toBe(201);
    const e = (await r.json()) as Exp;
    expect(e.amountExVatOre).toBe(100000);
    expect(e.vatOre).toBe(6250);
    expect(e.amountInclOre).toBe(106250);
    expect(e.filePath).toBe(`files/expenses/${e.voucherNumber}.png`);
  });

  it('rejects disallowed file types', async () => {
    const fd = new FormData();
    fd.set('date', '2026-09-06');
    fd.set('supplier', 'X');
    fd.set('description', 'Y');
    fd.set('category', 'Z');
    fd.set('amountExVat', '1');
    fd.set('vat', '0');
    fd.set('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
    const r = await c.raw('POST', '/api/expenses', fd);
    expect(r.status).toBe(400);
  });

  it('lists categories from prior values', async () => {
    const r = await c.json<string[]>('GET', '/api/expenses/categories');
    expect(r.data).toContain('Software');
    expect(r.data).toContain('Repræsentation');
  });
});
