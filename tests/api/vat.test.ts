import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';
import { quarterOf, todayIso } from '../../src/lib/format';

type Vat = {
  salesVatOre: number;
  purchaseVatOre: number;
  netVatOre: number;
  salesRows: { invoiceNumber: number; vatOre: number }[];
  purchaseRows: { voucherNumber: number; vatOre: number }[];
};

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

/**
 * Hand-computed from scripts/seed.ts (øre):
 *  Q2 2026 sales VAT: 1001 = 46.800,00 * 25 % = 11.700,00 ; 1002 = 12.000,00 * 25 % = 3.000,00  -> 1.470.000
 *  Q2 2026 purchase VAT: voucher 1 = 74,75 ; 2 = 0 ; 3 = 75,00                                  ->    14.975
 *  Q3 2026 sales VAT: 1003 = 0 (exempt) ; 1004 = 9.700,00 * 25 % = 2.425,00 ; 1005 = 12.500,00 * 25 % = 3.125,00 -> 555.000
 *    plus credit note 1006 (dated today) = -3.000,00 if today falls in Q3 2026.
 *  Q3 2026 purchase VAT: voucher 4 = 80,00 ; 5 = 0 ; 6 = 0 ; 7 = 625,00 ; 8 = 599,80             ->   130.480
 * Later tests add invoices/expenses dated in September 2026; those are filtered out below by number.
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

  it('Q3 2026 nets the credit note against the original and includes only seed rows', async () => {
    const r = await c.json<Vat>('GET', '/api/vat?year=2026&quarter=3');
    const seedSales = r.data.salesRows.filter((x) => x.invoiceNumber >= 1003 && x.invoiceNumber <= 1006);
    const seedPurchases = r.data.purchaseRows.filter((x) => x.voucherNumber >= 4 && x.voucherNumber <= 8);
    const creditNoteInQ3 = quarterOf(todayIso()).year === 2026 && quarterOf(todayIso()).quarter === 3;

    const expectedSales = 0 + 242_500 + 312_500 + (creditNoteInQ3 ? -300_000 : 0);
    expect(seedSales.reduce((s, x) => s + x.vatOre, 0)).toBe(expectedSales);
    expect(seedPurchases.map((x) => x.vatOre)).toEqual([8_000, 0, 0, 62_500, 59_980]);
    expect(seedPurchases.reduce((s, x) => s + x.vatOre, 0)).toBe(130_480);

    // The full figures are the sum of the drill-down rows (report is computed live from data).
    expect(r.data.salesVatOre).toBe(r.data.salesRows.reduce((s, x) => s + x.vatOre, 0));
    expect(r.data.purchaseVatOre).toBe(r.data.purchaseRows.reduce((s, x) => s + x.vatOre, 0));
    expect(r.data.netVatOre).toBe(r.data.salesVatOre - r.data.purchaseVatOre);
  });

  it('credit note (1006) and credited original (1002) both appear, netting to zero VAT', async () => {
    const all = await c.json<{ invoiceNumber: number; vatOre: number; status: string }[]>('GET', '/api/invoices');
    const orig = all.data.find((i) => i.invoiceNumber === 1002)!;
    const credit = all.data.find((i) => i.invoiceNumber === 1006)!;
    expect(orig.status).toBe('credited');
    expect(credit.vatOre).toBe(-orig.vatOre);
  });

  it('rejects bad quarters', async () => {
    expect((await c.json('GET', '/api/vat?year=2026&quarter=5')).status).toBe(400);
  });
});
