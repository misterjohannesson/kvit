/**
 * Suppliers as rows with ids, the expense form's dropdown-or-new-name, the expense report (accounts × suppliers ×
 * months) and the bank ledger (kontoudtog) with primo/ultimo. Hand-computed from the seed:
 *   Q2 2026 expenses: voucher 1 (2026-04-02, Dansk Telefoni A/S, 2900, 299,00), voucher 2 (2026-05-11, Adobe, 2000,
 *   450,00), voucher 3 (2026-06-15, Restaurant Kødbyen, 2200, 1.200,00). Account 2000 over the year: Adobe 450,00 +
 *   Hetzner 380,00 (2026-07-22) = 830,00.
 *   Bank: opening 50.000,00 on 2026-01-01; April: voucher 1 paid 2026-04-02 (−373,75), invoice 1001 paid 2026-04-27
 *   (+58.500,00).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

type Supplier = { id: number; name: string; usage: number; totalExVatOre: number; lastDate: string | null };
type Expense = { id: number; voucherNumber: number; supplier: string; supplierId: number; accountId: number; date: string; description: string; amountExVatOre: number; vatOre: number; paidDate: string | null };

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

async function action(path: string, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return c.raw('POST', path, fd, { accept: 'text/html' });
}

describe('suppliers', () => {
  it('the seed\'s suppliers were created from the expense names, one row per distinct name, with usage', async () => {
    const list = (await c.json<Supplier[]>('GET', '/api/suppliers')).data;
    const adobe = list.find((s) => s.name.startsWith('Adobe'))!;
    expect(adobe).toBeDefined();
    expect(adobe.usage).toBe(1);
    expect(adobe.totalExVatOre).toBe(45_000);
    expect(adobe.lastDate).toBe('2026-05-11');
    const expenses = (await c.json<Expense[]>('GET', '/api/expenses?year=2026')).data;
    for (const e of expenses) {
      expect(e.supplierId).toBeGreaterThan(0);
      expect(list.find((s) => s.id === e.supplierId)?.name).toBe(e.supplier);
    }
  });

  it('an expense with a new name creates the supplier; the same name (ignoring case) reuses it; an id works too', async () => {
    const before = (await c.json<Supplier[]>('GET', '/api/suppliers')).data.length;
    const a = await c.json<Expense>('POST', '/api/expenses', { date: '2026-09-06', supplier: '  Ny   Leverandør ApS ', description: 'Første', accountId: 11, amountExVatOre: 1000, vatOre: 250 });
    expect(a.status).toBe(201);
    expect(a.data.supplier).toBe('Ny Leverandør ApS');
    const b = await c.json<Expense>('POST', '/api/expenses', { date: '2026-09-06', supplier: 'ny leverandør aps', description: 'Anden', accountId: 11, amountExVatOre: 2000, vatOre: 500 });
    expect(b.data.supplierId).toBe(a.data.supplierId);
    const byId = await c.json<Expense>('POST', '/api/expenses', { date: '2026-09-06', supplierId: a.data.supplierId, description: 'Tredje', accountId: 11, amountExVatOre: 3000, vatOre: 750 });
    expect(byId.data.supplier).toBe('Ny Leverandør ApS');
    expect((await c.json<Supplier[]>('GET', '/api/suppliers')).data.length).toBe(before + 1);
    // Neither id nor name -> 400; unknown id -> 400.
    expect((await c.json('POST', '/api/expenses', { date: '2026-09-06', description: 'X', accountId: 11, amountExVatOre: 1, vatOre: 0 })).status).toBe(400);
    expect((await c.json('POST', '/api/expenses', { date: '2026-09-06', supplierId: 999_999, description: 'X', accountId: 11, amountExVatOre: 1, vatOre: 0 })).status).toBe(400);
  });

  it('the form takes an existing id from the select or a typed name when "__new__" is chosen', async () => {
    const supplierId = (await c.json<Supplier[]>('GET', '/api/suppliers')).data.find((s) => s.name === 'Ny Leverandør ApS')!.id;
    const picked = await action('/udgifter?/create', { date: '06.09.2026', supplierId: String(supplierId), description: 'Via select', accountId: '11', amountExVat: '10,00', vat: '2,50', paidDate: '' });
    expect(picked.status).toBe(303);
    const typed = await action('/udgifter?/create', { date: '06.09.2026', supplierId: '__new__', supplier: 'Formleverandør Ny', description: 'Via tekst', accountId: '11', amountExVat: '10,00', vat: '2,50', paidDate: '' });
    expect(typed.status).toBe(303);
    const empty = await action('/udgifter?/create', { date: '06.09.2026', supplierId: '__new__', supplier: '', description: 'Ingen', accountId: '11', amountExVat: '10,00', vat: '2,50', paidDate: '' });
    expect(empty.status).toBe(400);
    expect(await empty.text()).toContain('Skriv navnet på den nye leverandør');
    const list = (await c.json<Supplier[]>('GET', '/api/suppliers')).data;
    expect(list.find((s) => s.name === 'Formleverandør Ny')?.usage).toBe(1);
  });

  it('renames (expenses follow), refuses duplicates, deletes only unused suppliers', async () => {
    const list = (await c.json<Supplier[]>('GET', '/api/suppliers')).data;
    const ny = list.find((s) => s.name === 'Ny Leverandør ApS')!;
    const dup = await c.json<{ error: string }>('PUT', `/api/suppliers/${ny.id}`, { name: 'formleverandør ny' });
    expect(dup.status).toBe(409);
    expect((await c.json('PUT', `/api/suppliers/${ny.id}`, { name: 'Ny Leverandør A/S' })).status).toBe(200);
    const expenses = (await c.json<Expense[]>('GET', '/api/expenses?year=2026')).data.filter((e) => e.supplierId === ny.id);
    expect(expenses.length).toBe(4);
    expect(expenses.every((e) => e.supplier === 'Ny Leverandør A/S')).toBe(true);
    expect((await c.json('DELETE', `/api/suppliers/${ny.id}`)).status).toBe(409);
    const created = await c.json<{ id: number }>('POST', '/api/suppliers', { name: 'Ubrugt' });
    expect(created.status).toBe(201);
    expect((await c.json('POST', '/api/suppliers', { name: 'ubrugt' })).status).toBe(409);
    expect((await c.json('DELETE', `/api/suppliers/${created.data.id}`)).status).toBe(200);
    expect((await c.json('GET', `/api/suppliers/${created.data.id}`)).status).toBe(404);
    // Audit trail for suppliers.
    const audit = (await c.json<{ entity: string; action: string }[]>('GET', '/api/audit?entity=supplier&limit=20')).data;
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['create', 'rename', 'delete']));
  });
});

describe('expense report', () => {
  type Report = {
    months: string[];
    accounts: { account: { number: number }; months: number[]; totalOre: number; count: number; suppliers: { supplier: { name: string }; months: number[]; totalOre: number; count: number }[] }[];
    suppliers: { supplier: { name: string }; totalOre: number; count: number; accounts: { number: number }[] }[];
    totalOre: number;
    vatOre: number;
    count: number;
    supplierCount: number;
  };

  it('Q2 2026 from the seed: three vouchers, three suppliers, per account and month', async () => {
    const r = (await c.json<Report>('GET', '/api/finance?view=expenses&year=2026&quarter=2')).data;
    expect(r.months).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(r.count).toBe(3);
    expect(r.supplierCount).toBe(3);
    expect(r.totalOre).toBe(29_900 + 45_000 + 120_000);
    expect(r.accounts.map((a) => a.account.number)).toEqual([2000, 2200, 2900]);
    const software = r.accounts.find((a) => a.account.number === 2000)!;
    expect(software.months).toEqual([0, 45_000, 0]);
    expect(software.suppliers).toEqual([expect.objectContaining({ supplier: expect.objectContaining({ name: expect.stringMatching(/^Adobe/) }), totalOre: 45_000, count: 1 })]);
    // Largest supplier first, with the accounts it was booked on.
    expect(r.suppliers[0]).toMatchObject({ supplier: { name: 'Restaurant Kødbyen' }, totalOre: 120_000, accounts: [{ number: 2200 }] });
    // Month columns add up to the totals.
    for (const a of r.accounts) expect(a.months.reduce((s, m) => s + m, 0)).toBe(a.totalOre);
  });

  it('the whole year shows account 2000 with two suppliers, largest first', async () => {
    const r = (await c.json<Report>('GET', '/api/finance?view=expenses&year=2026')).data;
    expect(r.months.length).toBe(12);
    const software = r.accounts.find((a) => a.account.number === 2000)!;
    // Earlier test files book small extra expenses on 2000; the seed's two suppliers stay the largest.
    expect(software.totalOre).toBeGreaterThanOrEqual(83_000);
    expect(software.suppliers.slice(0, 2).map((s) => s.supplier.name.split(' ')[0])).toEqual(['Adobe', 'Hetzner']);
    expect(software.months[4]).toBe(45_000);
    expect(software.months[6]).toBe(38_000);
    expect((await c.json('GET', '/api/finance?view=expenses&year=2026&quarter=5')).status).toBe(400);
  });
});

describe('kontoudtog (bank ledger)', () => {
  type Ledger = { from: string; to: string; primoOre: number; inOre: number; outOre: number; ultimoOre: number; rows: { date: string; kind: string; ref: string; amountOre: number; balanceOre: number; counterparty: string; movementKind: string | null }[]; excludedBeforeOpening: number };

  it('April 2026 from the seed: primo is the opening balance, two flows, running balance, ultimo', async () => {
    const l = (await c.json<Ledger>('GET', '/api/finance?view=ledger&from=2026-04-01&to=2026-04-30')).data;
    expect(l.primoOre).toBe(5_000_000);
    expect(l.rows.map((r) => [r.date, r.kind, r.ref, r.amountOre, r.balanceOre])).toEqual([
      ['2026-04-02', 'expense', '1', -37_375, 5_000_000 - 37_375],
      ['2026-04-27', 'invoice', '1001', 5_850_000, 5_000_000 - 37_375 + 5_850_000]
    ]);
    expect(l.rows[0].counterparty).toBe('Dansk Telefoni A/S');
    expect(l.rows[1].counterparty).toBe('Nordhavn Arkitekter ApS');
    expect(l.inOre).toBe(5_850_000);
    expect(l.outOre).toBe(37_375);
    expect(l.ultimoOre).toBe(5_000_000 - 37_375 + 5_850_000);
    // The next window starts where this one ended.
    const may = (await c.json<Ledger>('GET', '/api/finance?view=ledger&from=2026-05-01&to=2026-05-31')).data;
    expect(may.primoOre).toBe(l.ultimoOre);
  });

  it('a window over everything ends on the balance page\'s likvider, and movements of every kind are listed', async () => {
    const l = (await c.json<Ledger>('GET', '/api/finance?view=ledger&from=2026-01-01&to=2099-12-31')).data;
    const balance = (await c.json<{ likviderOre: number }>('GET', '/api/finance?view=balance')).data;
    expect(l.ultimoOre).toBe(balance.likviderOre);
    expect(l.primoOre).toBe(5_000_000);
    const kinds = new Set(l.rows.filter((r) => r.kind === 'movement').map((r) => r.movementKind));
    for (const k of ['vat_payment', 'owner', 'tax', 'other']) expect(kinds, k).toContain(k);
    expect(l.rows.some((r) => r.kind === 'credit_note')).toBe(true);
    // Rows are dated within the window and the running balance is consistent.
    let running = l.primoOre;
    for (const r of l.rows) {
      expect(r.date >= '2026-01-01').toBe(true);
      running += r.amountOre;
      expect(r.balanceOre).toBe(running);
    }
    expect((await c.json('GET', '/api/finance?view=ledger&from=2026-05-01&to=2026-04-01')).status).toBe(400);
    expect((await c.json('GET', '/api/finance?view=ledger&from=x&to=2026-04-01')).status).toBe(400);
  });

  it('the CSV carries primo and ultimo lines and the page renders the presets', async () => {
    const r = await c.raw('GET', '/api/finance?view=ledger&from=2026-04-01&to=2026-04-30&format=csv');
    expect(r.headers.get('content-disposition')).toContain('kontoudtog-2026-04-01-2026-04-30.csv');
    const lines = (await r.text()).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('dato;type;nr;tekst;modpart;ind;ud;saldo');
    expect(lines[1]).toBe('2026-04-01;primo;;Primo saldo;;;;50000,00');
    expect(lines[lines.length - 1]).toBe('2026-04-30;ultimo;;Ultimo saldo;;58500,00;373,75;108126,25');
    const page = await c.raw('GET', '/kontoudtog?period=last_quarter', undefined, { accept: 'text/html' });
    expect(page.status).toBe(200);
    const html = await page.text();
    for (const label of ['Denne måned', 'Sidste måned', 'Dette kvartal', 'Sidste kvartal', 'I år', 'Primo', 'Ultimo']) expect(html).toContain(label);
    const custom = await c.raw('GET', '/kontoudtog?period=custom&from=01.04.2026&to=30.04.2026', undefined, { accept: 'text/html' });
    expect(await custom.text()).toContain('108.126,25');
  });
});
