/**
 * Finance views on the seed data, hand-computed in øre. Runs first (alphabetical
 * sequencer) so later test files' invoices and expenses do not disturb the sums.
 *
 * Seed (scripts/seed.ts):
 *  Opening balance 50.000,00 (2026-01-01).
 *  Paid invoices incl. VAT: 1001 58.500,00 (27.04), 1002 15.000,00 (01.06, later credited but the money came in),
 *    1003 18.000,00 (20.07)                                            -> in  91.500,00
 *  Paid expenses incl. VAT: 373,75 + 450,00 + 1.275,00 + 400,00 + 380,00 + 596,00 + 3.125,00 -> out 6.599,75
 *  Movements: -5.000,00 (tax) -10.000,00 (owner) -45,00 (other) -14.550,25 (vat_payment)   -> -29.595,25
 *  Likvider = 50.000 + 91.500 - 6.599,75 - 29.595,25 = 105.305,00
 *  Debitorer = open issued: 1004 12.125,00 + 1005 15.625,00 = 27.750,00
 *  Kreditorer = unpaid expenses incl. VAT: voucher 8 2.399,20 + 599,80 = 2.999,00
 *  Accrued momstilsvar (all time) = sales VAT 17.250,00 (11.700 + 3.000 + 0 + 2.425 + 3.125 - 3.000) - purchase VAT 1.454,55 = 15.795,45
 *  Skyldig moms = 15.795,45 - 14.550,25 (vat_payment) = 1.245,20
 *  Skyldige kreditnotaer = 1006 (credits the paid 1002, not refunded) = 15.000,00
 *  Resultat 2026: 1000 Konsulentydelser 46.800 + 12.000 - 12.000 + 12.500 = 59.300,00 ; 1100 Andet salg 9.700,00 ;
 *    1200 Momsfrit salg 18.000,00 -> revenue 87.000,00 (99.000,00 if the credit note falls outside 2026). Costs: 2000 830,00 ; 2100 2.719,20 ; 2200 1.200,00 ;
 *    2300 596,00 ; 2500 2.500,00 ; 2900 299,00 -> 8.144,20. Resultat 78.855,80.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

type Balance = { likviderOre: number; debitorerOre: number; kreditorerOre: number; skyldigeKreditnotaerOre: number; skyldigMomsOre: number; nettoOre: number; accruedVatOre: number; vatPaymentsOre: number };
type Resultat = { revenue: { account: { number: number }; totalOre: number }[]; costs: { account: { number: number }; totalOre: number }[]; revenueOre: number; costsOre: number; resultOre: number };
type Cashflow = { openingBalanceOre: number; months: { month: string; inOre: number; outOre: number; netOre: number; positionOre: number }[]; expected: { month: string; totalOre: number; count: number }[]; closingPositionOre: number };

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

const byNumber = (rows: { account: { number: number }; totalOre: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.account.number, r.totalOre]));

describe('balance on seed data', () => {
  it('Likvider, Debitorer, Kreditorer and Skyldig moms match hand-computed values', async () => {
    const r = await c.json<Balance>('GET', '/api/finance?view=balance');
    expect(r.status).toBe(200);
    expect(r.data.likviderOre).toBe(10_530_500);
    expect(r.data.debitorerOre).toBe(2_775_000);
    expect(r.data.kreditorerOre).toBe(299_900);
    expect(r.data.accruedVatOre).toBe(1_579_545);
    expect(r.data.vatPaymentsOre).toBe(-1_455_025);
    expect(r.data.skyldigMomsOre).toBe(124_520);
    // 1002 was paid, then credited by 1006 which is not refunded: 15.000,00 owed back.
    expect(r.data.skyldigeKreditnotaerOre).toBe(1_500_000);
    expect(r.data.nettoOre).toBe(10_530_500 + 2_775_000 - 299_900 - 1_500_000 - 124_520);
  });
});

describe('resultat on seed data', () => {
  it('revenue and costs per account for 2026 match hand-computed values', async () => {
    const r = await c.json<Resultat>('GET', '/api/finance?view=resultat&year=2026');
    expect(r.status).toBe(200);
    // The credit note (1006) is dated the seed day; its -12.000,00 only lands in 2026 if that day is in 2026.
    const invoices = await c.json<{ invoiceNumber: number; issueDate: string }[]>('GET', '/api/invoices');
    const creditIn2026 = invoices.data.find((i) => i.invoiceNumber === 1006)!.issueDate.startsWith('2026-') ? -1_200_000 : 0;
    const rev = byNumber(r.data.revenue);
    expect(rev[1000]).toBe(7_130_000 + creditIn2026);
    expect(rev[1100]).toBe(970_000);
    expect(rev[1200]).toBe(1_800_000);
    const cost = byNumber(r.data.costs);
    expect(cost[2000]).toBe(83_000);
    expect(cost[2100]).toBe(271_920);
    expect(cost[2200]).toBe(120_000);
    expect(cost[2300]).toBe(59_600);
    expect(cost[2400]).toBe(0);
    expect(cost[2500]).toBe(250_000);
    expect(cost[2600]).toBe(0);
    expect(cost[2900]).toBe(29_900);
    expect(r.data.revenueOre).toBe(9_900_000 + creditIn2026);
    expect(r.data.costsOre).toBe(814_420);
    expect(r.data.resultOre).toBe(9_900_000 + creditIn2026 - 814_420);
  });

  it('quarter filter is accrual-based: Q2 2026 has 1001 and 1002 revenue and vouchers 1–3', async () => {
    const r = await c.json<Resultat>('GET', '/api/finance?view=resultat&year=2026&quarter=2');
    expect(byNumber(r.data.revenue)[1000]).toBe(4_680_000 + 1_200_000);
    expect(r.data.costsOre).toBe(29_900 + 45_000 + 120_000);
  });
});

describe('cashflow on seed data', () => {
  it('runs from the opening balance month with the hand-computed monthly flows', async () => {
    const r = await c.json<Cashflow>('GET', '/api/finance?view=cashflow');
    expect(r.status).toBe(200);
    expect(r.data.openingBalanceOre).toBe(5_000_000);
    expect(r.data.months[0].month).toBe('2026-01');
    const m = Object.fromEntries(r.data.months.map((x) => [x.month, x]));
    expect(m['2026-04'].inOre).toBe(5_850_000);
    expect(m['2026-04'].outOre).toBe(37_375);
    expect(m['2026-04'].positionOre).toBe(5_000_000 + 5_850_000 - 37_375);
    expect(m['2026-05'].outOre).toBe(45_000 + 500_000);
    expect(m['2026-06'].inOre).toBe(1_500_000);
    expect(m['2026-07'].outOre).toBe(40_000 + 38_000 + 1_000_000);
    expect(m['2026-09'].outOre).toBe(1_455_025);
    expect(r.data.closingPositionOre).toBe(10_530_500);
    // Expected: open invoices by due month.
    expect(r.data.expected).toEqual([
      { month: '2026-08', totalOre: 1_212_500, count: 1 },
      { month: '2026-09', totalOre: 1_562_500, count: 1 }
    ]);
  });
});

describe('reconciliation and forms', () => {
  const action = async (path: string, fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return c.raw('POST', path, fd, { accept: 'text/html' });
  };

  it('books a correction for the difference between the bank and Likvider, bound to the previewed figure', async () => {
    const before = (await c.json<Balance>('GET', '/api/finance?view=balance')).data;
    const preview = await action('/balance?/reconcile', { actual: '105.000,00' });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('305,00');
    // Booking without the previewed figure is refused.
    expect((await action('/balance?/book', { actual: '105.000,00' })).status).toBe(400);
    // Stale previewed Likvider -> 409, nothing booked.
    const stale = await action('/balance?/book', { actual: '105.000,00', expectedLikvider: '1,00' });
    expect(stale.status).toBe(409);
    expect((await c.json<Balance>('GET', '/api/finance?view=balance')).data.likviderOre).toBe(before.likviderOre);
    const booked = await action('/balance?/book', { actual: '105.000,00', expectedLikvider: '105.305,00' });
    expect(booked.status).toBe(200);
    const after = (await c.json<Balance>('GET', '/api/finance?view=balance')).data;
    expect(after.likviderOre).toBe(10_500_000);
    const mv = (await c.json<{ kind: string; amountOre: number; description: string }[]>('GET', '/api/cash-movements')).data;
    const corr = mv.find((m) => m.kind === 'correction')!;
    expect(corr.amountOre).toBe(-30_500);
    expect(corr.description).toContain('105.000,00 kr.');
    // Same figure again: nothing to book.
    expect((await action('/balance?/book', { actual: '105.000,00', expectedLikvider: '105.000,00' })).status).toBe(400);
  });

  it('creates a movement from the cashflow form and rejects an impossible date', async () => {
    const ok = await action('/cashflow?/create', { date: '15.09.2026', description: 'Indskud', amount: '2.000,00', kind: 'owner' });
    expect(ok.status).toBe(200);
    const bad = await action('/cashflow?/create', { date: '31.13.2026', description: '', amount: 'abc', kind: 'owner' });
    expect(bad.status).toBe(400);
    const badJson = await c.json('POST', '/api/cash-movements', { date: '2026-13-01', description: 'x', amountOre: -100, kind: 'other' });
    expect(badJson.status).toBe(400);
    const after = (await c.json<Balance>('GET', '/api/finance?view=balance')).data;
    expect(after.likviderOre).toBe(10_500_000 + 200_000);
  });

  it('flows dated before the opening balance date are not counted again', async () => {
    const settings = (await c.json<Record<string, string>>('GET', '/api/settings')).data;
    try {
      const moved = await c.json<Record<string, string>>('PUT', '/api/settings', { opening_balance_date: '2026-05-01' });
      expect(moved.status).toBe(200);
      const cf = await c.json<Cashflow & { excludedBeforeOpening: { count: number; netOre: number } }>('GET', '/api/finance?view=cashflow');
      // April: invoice 1001 (+58.500) and voucher 1 (-373,75) are now inside the opening balance.
      expect(cf.data.excludedBeforeOpening).toEqual({ count: 2, netOre: 5_850_000 - 37_375 });
      expect(cf.data.months[0].month).toBe('2026-05');
      expect(cf.data.closingPositionOre).toBe(10_700_000 - (5_850_000 - 37_375));
    } finally {
      await c.json('PUT', '/api/settings', { opening_balance_date: settings.opening_balance_date });
    }
  });

  it('manages the kontoplan through the settings forms', async () => {
    const add = await action('/indstillinger?/addAccount', { number: '2800', name: 'Kurser', type: 'cost' });
    expect(add.status).toBe(200);
    const accounts = (await c.json<{ id: number; number: number; name: string }[]>('GET', '/api/accounts')).data;
    const added = accounts.find((a) => a.number === 2800)!;
    expect(added).toBeDefined();
    expect((await action('/indstillinger?/renameAccount', { id: String(added.id), name: 'Kurser og uddannelse' })).status).toBe(200);
    expect((await c.json<{ name: string }>('GET', `/api/accounts/${added.id}`)).data.name).toBe('Kurser og uddannelse');
    expect((await action('/indstillinger?/deleteAccount', { id: 'abc' })).status).toBe(400);
    expect((await action('/indstillinger?/deleteAccount', { id: String(added.id) })).status).toBe(200);
    expect((await c.json('GET', `/api/accounts/${added.id}`)).status).toBe(404);
    const emptyBalance = await action('/indstillinger?/save', {
      company_name: 'Mit Firma ApS', company_address: 'Eksempelvej 1', company_zip: '2100', company_city: 'K', company_cvr: '12345678',
      bank_reg: '1234', bank_account: '1234567890', payment_terms_days: '14', next_invoice_number: '1007', vat_registered: 'on',
      opening_balance: '', opening_balance_date: '01.01.2026'
    });
    expect(emptyBalance.status).toBe(400);
  });
});

describe('cash movements and accounts API', () => {
  it('lists the four seeded movements and the eleven seeded accounts', async () => {
    const mv = await c.json<{ kind: string; date: string }[]>('GET', '/api/cash-movements');
    // Earlier tests in this file book further movements (all dated after the seed's last one).
    const seeded = mv.data.filter((x) => x.date <= '2026-09-01');
    expect(seeded.map((x) => x.kind).sort()).toEqual(['other', 'owner', 'tax', 'vat_payment']);
    const acc = await c.json<{ number: number; type: string }[]>('GET', '/api/accounts');
    expect(acc.data.map((a) => a.number)).toEqual([1000, 1100, 1200, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2900]);
    expect(acc.data.filter((a) => a.type === 'revenue').length).toBe(3);
  });

  it('rejects a cost account on an invoice line and a revenue account on an expense', async () => {
    const cust = await c.json<{ id: number }>('GET', '/api/customers');
    const customerId = (cust.data as unknown as { id: number }[])[0].id;
    const d = await c.json<{ id: number }>('POST', '/api/invoices', { customerId });
    const bad = await c.json<{ error: string }>('PUT', `/api/invoices/${d.data.id}`, {
      customerId, issueDate: '2026-09-07', dueDate: '2026-09-21', paymentReference: 'x',
      lines: [{ description: 'A', quantity: 1, unit: 'stk.', unitPriceOre: 100, accountId: 11 }]
    });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toContain('salgskonto');
    expect((await c.json('DELETE', `/api/invoices/${d.data.id}`)).status).toBe(200);
    const badExp = await c.json<{ error: string }>('POST', '/api/expenses', {
      date: '2026-09-05', supplier: 'X', description: 'Y', accountId: 1, amountExVatOre: 100, vatOre: 25
    });
    expect(badExp.status).toBe(400);
    expect(badExp.data.error).toContain('omkostningskonto');
  });

  it('accounts can be added and renamed but not deleted while referenced', async () => {
    const created = await c.json<{ id: number; number: number }>('POST', '/api/accounts', { number: 2700, name: 'Telefoni', type: 'cost' });
    expect(created.status).toBe(201);
    const dup = await c.json('POST', '/api/accounts', { number: 2700, name: 'Dup', type: 'cost' });
    expect(dup.status).toBe(409);
    const renamed = await c.json<{ name: string }>('PUT', `/api/accounts/${created.data.id}`, { name: 'Telefoni og internet' });
    expect(renamed.data.name).toBe('Telefoni og internet');
    // Referenced account (2900 Øvrige, id 11, used by voucher 1) cannot be deleted.
    expect((await c.json('DELETE', '/api/accounts/11')).status).toBe(409);
    expect((await c.json('DELETE', `/api/accounts/${created.data.id}`)).status).toBe(200);
  });

  it('movements are created, never edited or deleted', async () => {
    const r = await c.json<{ id: number; amountOre: number }>('POST', '/api/cash-movements', {
      date: '2026-09-06', description: 'Test', amountOre: -1000, kind: 'other'
    });
    expect(r.status).toBe(201);
    expect((await c.raw('PUT', `/api/cash-movements/${r.data.id}`, {})).status).toBe(404);
    expect((await c.raw('DELETE', `/api/cash-movements/${r.data.id}`)).status).toBe(404);
    const zero = await c.json('POST', '/api/cash-movements', { date: '2026-09-06', description: 'Nul', amountOre: 0, kind: 'other' });
    expect(zero.status).toBe(400);
  });
});
