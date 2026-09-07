/**
 * Seed: owner settings, 3 customers, 5 issued invoices (one VAT-exempt with
 * reason, one credited -> credit note 1006).
 *
 * Refuses to run on a database that already holds invoices or expenses, so it
 * can never pollute a real bookkeeping.
 *
 * Usage: DATA_DIR=/data APP_PASSWORD=... npm run seed
 */
import { db } from '../src/lib/server/db';
import { invoice } from '../src/lib/server/schema';
import { sql } from 'drizzle-orm';
import { updateSettings } from '../src/lib/server/services/settings';
import { createCustomer } from '../src/lib/server/services/customers';
import { createDraft, creditInvoice, issueInvoice, setPaidDate, updateDraft } from '../src/lib/server/services/invoices';
import { closeBrowser } from '../src/lib/server/pdf';

export const REVERSE_CHARGE_REASON = 'Omvendt betalingspligt, jf. momslovens § 46';

export const SEED = {
  settings: {
    company_name: 'Mit Firma ApS',
    company_address: 'Eksempelvej 1',
    company_zip: '2100',
    company_city: 'København Ø',
    company_cvr: '12345678',
    bank_reg: '1234',
    bank_account: '1234567890',
    payment_terms_days: 14,
    next_invoice_number: 1001,
    vat_registered: '1'
  },
  customers: [
    { name: 'Nordhavn Arkitekter ApS', address: 'Sundkrogsgade 21', zip: '2100', city: 'København Ø', country: 'DK', cvr: '38412207', email: 'bogholderi@nordhavn-ark.dk' },
    { name: 'Vestergaard Consulting', address: 'Åboulevarden 12', zip: '8000', city: 'Aarhus C', country: 'DK', cvr: null, email: 'mv@vestergaard.dk' },
    { name: 'Berlin Software GmbH', address: 'Friedrichstraße 100', zip: '10117', city: 'Berlin', country: 'DE', cvr: null, email: 'ap@berlinsoftware.de' }
  ],
  /** In issue order: numbers 1001..1005. Amounts in øre. */
  invoices: [
    {
      customer: 0, issueDate: '2026-04-14', dueDate: '2026-04-28', paidDate: '2026-04-27', vatExemptReason: null,
      lines: [
        { description: 'Konceptudvikling, uge 12–14', quantity: 42, unit: 'time', unitPriceOre: 95000 },
        { description: 'Projektledelse', quantity: 6, unit: 'time', unitPriceOre: 115000 }
      ]
    },
    {
      customer: 1, issueDate: '2026-05-20', dueDate: '2026-06-03', paidDate: '2026-06-01', vatExemptReason: null,
      lines: [{ description: 'Rådgivning, maj', quantity: 10, unit: 'time', unitPriceOre: 120000 }]
    },
    {
      customer: 2, issueDate: '2026-07-08', dueDate: '2026-07-22', paidDate: '2026-07-20', vatExemptReason: REVERSE_CHARGE_REASON,
      lines: [{ description: 'Softwareudvikling, sprint 14', quantity: 20, unit: 'time', unitPriceOre: 90000 }]
    },
    {
      customer: 0, issueDate: '2026-08-03', dueDate: '2026-08-17', paidDate: null, vatExemptReason: null,
      lines: [
        { description: 'Workshop, designsystem', quantity: 1, unit: 'stk.', unitPriceOre: 850000 },
        { description: 'Transport, Kbh–Aarhus', quantity: 1, unit: 'stk.', unitPriceOre: 120000 }
      ]
    },
    {
      customer: 1, issueDate: '2026-08-25', dueDate: '2026-09-24', paidDate: null, vatExemptReason: null,
      lines: [{ description: 'Analyse og rapport', quantity: 12.5, unit: 'time', unitPriceOre: 100000 }]
    }
  ],
  /** Index (0-based) of the invoice that is credited: 1002. Credit note becomes 1006, dated today. */
  creditedInvoiceIndex: 1
};

export async function seed(): Promise<void> {
  const nInv = db.select({ n: sql<number>`count(*)` }).from(invoice).get()?.n ?? 0;
  if (nInv > 0) {
    throw new Error('Databasen er ikke tom (fakturaer findes). Seed afbrudt.');
  }

  await updateSettings(SEED.settings);
  const customers = SEED.customers.map((c) => createCustomer(c));

  const issued = [];
  for (const spec of SEED.invoices) {
    const draft = createDraft({ customerId: customers[spec.customer].id });
    updateDraft(draft.id, {
      customerId: customers[spec.customer].id,
      issueDate: spec.issueDate,
      dueDate: spec.dueDate,
      vatExemptReason: spec.vatExemptReason,
      paymentReference: draft.paymentReference,
      lines: spec.lines
    });
    const inv = await issueInvoice(draft.id);
    if (spec.paidDate) setPaidDate(inv.id, spec.paidDate);
    issued.push(inv);
  }
  await creditInvoice(issued[SEED.creditedInvoiceIndex].id);

}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/seed.ts');
if (isMain) {
  seed()
    .then(async () => {
      await closeBrowser();
      console.log('Seed gennemført: 3 kunder, 6 udstedte dokumenter (1001–1006).');
      process.exit(0);
    })
    .catch(async (e) => {
      await closeBrowser();
      console.error(e.message ?? e);
      process.exit(1);
    });
}
