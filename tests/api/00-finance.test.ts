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
 *  Resultat 2026: 1000 Konsulentydelser 46.800 + 12.000 - 12.000 + 12.500 = 59.300,00 ; 1100 Andet salg 9.700,00 ;
 *    1200 Momsfrit salg 18.000,00 -> revenue 87.000,00. Costs: 2000 830,00 ; 2100 2.719,20 ; 2200 1.200,00 ;
 *    2300 596,00 ; 2500 2.500,00 ; 2900 299,00 -> 8.144,20. Resultat 78.855,80.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

type Balance = { likviderOre: number; debitorerOre: number; kreditorerOre: number; skyldigMomsOre: number; nettoOre: number; accruedVatOre: number; vatPaymentsOre: number };
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
    expect(r.data.nettoOre).toBe(10_530_500 + 2_775_000 - 299_900 - 124_520);
  });
});

describe('resultat on seed data', () => {
  it('revenue and costs per account for 2026 match hand-computed values', async () => {
    const r = await c.json<Resultat>('GET', '/api/finance?view=resultat&year=2026');
    expect(r.status).toBe(200);
    const rev = byNumber(r.data.revenue);
    expect(rev[1000]).toBe(5_930_000);
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
    expect(r.data.revenueOre).toBe(8_700_000);
    expect(r.data.costsOre).toBe(814_420);
    expect(r.data.resultOre).toBe(7_885_580);
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

describe('cash movements and accounts API', () => {
  it('lists the four seeded movements and the eleven seeded accounts', async () => {
    const mv = await c.json<{ kind: string }[]>('GET', '/api/cash-movements');
    expect(mv.data.map((x) => x.kind).sort()).toEqual(['other', 'owner', 'tax', 'vat_payment']);
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
