/**
 * Seed: owner settings incl. opening balance, 3 customers, 5 issued invoices
 * (one VAT-exempt with reason, one credited -> credit note 1006), 8 expenses
 * with dummy files on cost accounts, and 4 cash movements (incl. one
 * vat_payment and one owner draw).
 *
 * Refuses to run on a database that already holds invoices, expenses or
 * movements, so it can never pollute a real bookkeeping.
 *
 * Usage: DATA_DIR=/data APP_PASSWORD=... npm run seed
 */
import { db } from '../src/lib/server/db';
import { invoice, expense, cashMovement } from '../src/lib/server/schema';
import { sql } from 'drizzle-orm';
import { updateSettings } from '../src/lib/server/services/settings';
import { createCustomer } from '../src/lib/server/services/customers';
import { createDraft, creditInvoice, issueInvoice, markSent, setPaidDate, updateDraft } from '../src/lib/server/services/invoices';
import { createExpense, type UploadFile } from '../src/lib/server/services/expenses';
import { createMovement } from '../src/lib/server/services/cash';
import { listAccounts } from '../src/lib/server/services/accounts';
import { closeBrowser, htmlToPdf } from '../src/lib/server/pdf';

export const REVERSE_CHARGE_REASON = 'Omvendt betalingspligt, jf. momslovens § 46';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const JPG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);

/** Account numbers from the seeded mini-kontoplan (migration 0006). */
export const ACC = {
  konsulent: 1000,
  andetSalg: 1100,
  momsfritSalg: 1200,
  software: 2000,
  kontorhold: 2100,
  repraesentation: 2200,
  rejser: 2300,
  revisor: 2500,
  oevrige: 2900
} as const;

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
    vat_registered: '1',
    /** 50.000,00 kr. in the bank on 1 January 2026. */
    opening_balance_ore: 5_000_000,
    opening_balance_date: '2026-01-01'
  },
  customers: [
    { name: 'Nordhavn Arkitekter ApS', address: 'Sundkrogsgade 21', zip: '2100', city: 'København Ø', country: 'DK', cvr: '38412207', email: 'bogholderi@nordhavn-ark.dk', paymentTermsDays: 30 },
    { name: 'Vestergaard Consulting', address: 'Åboulevarden 12', zip: '8000', city: 'Aarhus C', country: 'DK', cvr: null, email: 'mv@vestergaard.dk' },
    { name: 'Berlin Software GmbH', address: 'Friedrichstraße 100', zip: '10117', city: 'Berlin', country: 'DE', cvr: null, email: 'ap@berlinsoftware.de' }
  ],
  /** In issue order: numbers 1001..1005. Amounts in øre; `account` is the kontoplan number. */
  invoices: [
    {
      customer: 0, issueDate: '2026-04-14', dueDate: '2026-04-28', paidDate: '2026-04-27', sentDate: '2026-04-14', vatExemptReason: null,
      lines: [
        { description: 'Konceptudvikling, uge 12–14', quantity: 42, unit: 'time', unitPriceOre: 95000, account: ACC.konsulent },
        { description: 'Projektledelse', quantity: 6, unit: 'time', unitPriceOre: 115000, account: ACC.konsulent }
      ]
    },
    {
      customer: 1, issueDate: '2026-05-20', dueDate: '2026-06-03', paidDate: '2026-06-01', sentDate: '2026-05-20', vatExemptReason: null,
      lines: [{ description: 'Rådgivning, maj', quantity: 10, unit: 'time', unitPriceOre: 120000, account: ACC.konsulent }]
    },
    {
      customer: 2, issueDate: '2026-07-08', dueDate: '2026-07-22', paidDate: '2026-07-20', sentDate: '2026-07-08', vatExemptReason: REVERSE_CHARGE_REASON,
      lines: [{ description: 'Softwareudvikling, sprint 14', quantity: 20, unit: 'time', unitPriceOre: 90000, account: ACC.momsfritSalg }]
    },
    {
      customer: 0, issueDate: '2026-08-03', dueDate: '2026-08-17', paidDate: null, sentDate: '2026-08-04', vatExemptReason: null,
      lines: [
        { description: 'Workshop, designsystem', quantity: 1, unit: 'stk.', unitPriceOre: 850000, account: ACC.andetSalg },
        { description: 'Transport, Kbh–Aarhus', quantity: 1, unit: 'stk.', unitPriceOre: 120000, account: ACC.andetSalg }
      ]
    },
    {
      customer: 1, issueDate: '2026-08-25', dueDate: '2026-09-24', paidDate: null, sentDate: null, vatExemptReason: null,
      lines: [{ description: 'Analyse og rapport', quantity: 12.5, unit: 'time', unitPriceOre: 100000, account: ACC.konsulent }]
    }
  ],
  /** Index (0-based) of the invoice that is credited: 1002. Credit note becomes 1006, dated the seed day. */
  creditedInvoiceIndex: 1,
  expenses: [
    { date: '2026-04-02', supplier: 'Dansk Telefoni A/S', description: 'Mobilabonnement, april', account: ACC.oevrige, amountExVatOre: 29900, vatOre: 7475, paidDate: '2026-04-02', file: 'pdf' },
    { date: '2026-05-11', supplier: 'Adobe Systems Software Ireland Ltd', description: 'Creative Cloud, årsabonnement', account: ACC.software, amountExVatOre: 45000, vatOre: 0, paidDate: '2026-05-11', file: 'pdf' },
    { date: '2026-06-15', supplier: 'Restaurant Kødbyen', description: 'Kundemøde, Nordhavn Arkitekter', account: ACC.repraesentation, amountExVatOre: 120000, vatOre: 7500, paidDate: '2026-06-15', file: 'jpg' },
    { date: '2026-07-05', supplier: 'Kontorforsyning ApS', description: 'Printerpapir og toner', account: ACC.kontorhold, amountExVatOre: 32000, vatOre: 8000, paidDate: '2026-07-05', file: 'pdf' },
    { date: '2026-07-22', supplier: 'Hetzner Online GmbH', description: 'Serverhosting, juli', account: ACC.software, amountExVatOre: 38000, vatOre: 0, paidDate: '2026-07-22', file: 'png' },
    { date: '2026-08-12', supplier: 'DSB', description: 'Togrejse København–Aarhus', account: ACC.rejser, amountExVatOre: 59600, vatOre: 0, paidDate: '2026-08-12', file: 'pdf' },
    { date: '2026-08-30', supplier: 'Revisionshuset ApS', description: 'Bogføringshjælp, 2. kvartal', account: ACC.revisor, amountExVatOre: 250000, vatOre: 62500, paidDate: '2026-08-30', file: 'pdf' },
    { date: '2026-09-02', supplier: 'Elgiganten A/S', description: 'Skærm 27"', account: ACC.kontorhold, amountExVatOre: 239920, vatOre: 59980, paidDate: null, file: 'png' }
  ],
  /** Signed øre, positive = in. Q2 2026 momstilsvar (14.550,25) paid on 1 September. */
  movements: [
    { date: '2026-05-20', description: 'B-skat, rate 5', amountOre: -500000, kind: 'tax' },
    { date: '2026-07-15', description: 'Privat hævning', amountOre: -1000000, kind: 'owner' },
    { date: '2026-08-31', description: 'Bankgebyr, august', amountOre: -4500, kind: 'other' },
    { date: '2026-09-01', description: 'Momsafregning 2. kvartal 2026', amountOre: -1455025, kind: 'vat_payment' }
  ]
};

async function dummyFile(kind: string, label: string): Promise<UploadFile> {
  if (kind === 'png') return { name: 'bilag.png', type: 'image/png', bytes: PNG_1X1 };
  if (kind === 'jpg') return { name: 'bilag.jpg', type: 'image/jpeg', bytes: JPG_1X1 };
  const html = `<!doctype html><html><body style="font-family:sans-serif"><h1>Bilag</h1><p>${label}</p></body></html>`;
  return { name: 'bilag.pdf', type: 'application/pdf', bytes: await htmlToPdf(html, '<span></span>') };
}

export async function seed(): Promise<void> {
  const count = (t: typeof invoice | typeof expense | typeof cashMovement) => db.select({ n: sql<number>`count(*)` }).from(t).get()?.n ?? 0;
  if (count(invoice) > 0 || count(expense) > 0 || count(cashMovement) > 0) {
    throw new Error('Databasen er ikke tom (fakturaer, udgifter eller bankbevægelser findes). Seed afbrudt.');
  }
  const accountId = new Map(listAccounts().map((a) => [a.number, a.id]));
  const acc = (number: number) => {
    const id = accountId.get(number);
    if (!id) throw new Error(`Konto ${number} mangler i kontoplanen`);
    return id;
  };

  await updateSettings(SEED.settings);
  const customers = SEED.customers.map((c) => createCustomer(c));

  const issued = [];
  for (const spec of SEED.invoices) {
    const draft = createDraft({ customerId: customers[spec.customer].id });
    await updateDraft(draft.id, {
      customerId: customers[spec.customer].id,
      issueDate: spec.issueDate,
      dueDate: spec.dueDate,
      vatExemptReason: spec.vatExemptReason,
      paymentReference: '',
      lines: spec.lines.map(({ account, ...l }) => ({ ...l, accountId: acc(account) }))
    });
    const inv = await issueInvoice(draft.id);
    if (spec.paidDate) setPaidDate(inv.id, spec.paidDate);
    // Everything but the newest invoice has gone to the customer; 1005 (and the credit note) demo the "ikke sendt" warning.
    if (spec.sentDate) markSent(inv.id, spec.sentDate);
    issued.push(inv);
  }
  await creditInvoice(issued[SEED.creditedInvoiceIndex].id);

  for (const e of SEED.expenses) {
    const { file, account, ...fields } = e;
    createExpense({ ...fields, accountId: acc(account) }, await dummyFile(file, `${e.supplier} – ${e.description}`));
  }

  for (const m of SEED.movements) createMovement(m);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/seed.ts');
if (isMain) {
  seed()
    .then(async () => {
      await closeBrowser();
      console.log('Seed gennemført: 3 kunder, 6 udstedte dokumenter (1001–1006), 8 udgifter, 4 bankbevægelser.');
      process.exit(0);
    })
    .catch(async (e) => {
      await closeBrowser();
      console.error(e.message ?? e);
      process.exit(1);
    });
}
