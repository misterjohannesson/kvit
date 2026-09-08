import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';
import { quarterOf } from '../../src/lib/format';

type Vat = {
  salesVatOre: number;
  purchaseVatOre: number;
  netVatOre: number;
  salesRows: { invoiceNumber: number; vatOre: number; issueDate: string }[];
  purchaseRows: { voucherNumber: number; vatOre: number }[];
};
type Inv = { invoiceNumber: number; vatOre: number; status: string; issueDate: string };

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

/**
 * Hand-computed from scripts/seed.ts (øre):
 *  Q2 2026 sales VAT: 1001 = 46.800,00 * 25 % = 11.700,00 ; 1002 = 12.000,00 * 25 % = 3.000,00  -> 1.470.000
 *  Q2 2026 purchase VAT: voucher 1 = 74,75 ; 2 = 0 ; 3 = 75,00                                  ->    14.975
 *  Q3 2026 sales VAT: 1003 = 0 (exempt) ; 1004 = 9.700,00 * 25 % = 2.425,00 ; 1005 = 12.500,00 * 25 % = 3.125,00 -> 555.000
 *  Q3 2026 purchase VAT: voucher 4 = 80,00 ; 5 = 0 ; 6 = 0 ; 7 = 625,00 ; 8 = 599,80             ->   130.480
 *  Credit note 1006 (dated the day the seed ran) = -3.000,00 in whichever quarter that day falls.
 * Other tests add invoices/expenses dated September 2026; those are filtered out below by number.
 */
describe('VAT report on seed data', () => {
  it('Q2 2026 matches hand-computed øre values', async () => {
    const r = await c.json<Vat>('GET', '/api/vat?year=2026&quarter=2');
    expect(r.status).toBe(200);
    expect(r.data.salesRows.map((x) => x.invoiceNumber)).toEqual([1001, 1002]);
    expect(r.data.salesVatOre).toBe(1_470_000);
    expect(r.data.purchaseRows.map((x) => x.voucherNumber)).toEqual([1, 2, 3]);
    expect(r.data.purchaseVatOre).toBe(14_975);
    expect(r.data.netVatOre).toBe(1_470_000 - 14_975);
  });

  it('Q3 2026 seed rows match hand-computed values and the figures equal the drill-down sums', async () => {
    const r = await c.json<Vat>('GET', '/api/vat?year=2026&quarter=3');
    const seedSales = r.data.salesRows.filter((x) => x.invoiceNumber >= 1003 && x.invoiceNumber <= 1005);
    const seedPurchases = r.data.purchaseRows.filter((x) => x.voucherNumber >= 4 && x.voucherNumber <= 8);
    expect(seedSales.map((x) => x.vatOre)).toEqual([0, 242_500, 312_500]);
    expect(seedPurchases.map((x) => x.vatOre)).toEqual([8_000, 0, 0, 62_500, 59_980]);
    expect(seedPurchases.reduce((s, x) => s + x.vatOre, 0)).toBe(130_480);

    // The report is computed live: figures are exactly the sum of their drill-down rows.
    expect(r.data.salesVatOre).toBe(r.data.salesRows.reduce((s, x) => s + x.vatOre, 0));
    expect(r.data.purchaseVatOre).toBe(r.data.purchaseRows.reduce((s, x) => s + x.vatOre, 0));
    expect(r.data.netVatOre).toBe(r.data.salesVatOre - r.data.purchaseVatOre);
  });

  it('credit note 1006 nets original 1002 to zero in the quarter it was issued', async () => {
    const all = await c.json<Inv[]>('GET', '/api/invoices');
    const orig = all.data.find((i) => i.invoiceNumber === 1002)!;
    const credit = all.data.find((i) => i.invoiceNumber === 1006)!;
    expect(orig.status).toBe('credited');
    expect(credit.vatOre).toBe(-300_000);
    expect(credit.vatOre).toBe(-orig.vatOre);

    const q = quarterOf(credit.issueDate);
    const r = await c.json<Vat>('GET', `/api/vat?year=${q.year}&quarter=${q.quarter}`);
    const row = r.data.salesRows.find((x) => x.invoiceNumber === 1006);
    expect(row?.vatOre).toBe(-300_000);
    // Removing both 1002 (if in this quarter) and 1006 changes the total by exactly their sum, i.e. zero when both are present.
    const pair = r.data.salesRows.filter((x) => x.invoiceNumber === 1002 || x.invoiceNumber === 1006);
    if (pair.length === 2) expect(pair.reduce((s, x) => s + x.vatOre, 0)).toBe(0);
  });

  it('rejects bad quarters', async () => {
    expect((await c.json('GET', '/api/vat?year=2026&quarter=5')).status).toBe(400);
  });
});
