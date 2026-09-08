/**
 * Screenshot every screen at 1440px width plus the issued-invoice PDF rendered
 * to an image. Used by the design review.
 *
 * Usage: BASE_URL=http://localhost:3101 APP_PASSWORD=... npx tsx review/shots.ts
 * Output: review/shots/*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFParse } from 'pdf-parse';

const BASE = process.env.BASE_URL ?? 'http://localhost:3101';
const PASSWORD = process.env.APP_PASSWORD ?? 'test1234';
const OUT = path.join(process.cwd(), 'review', 'shots');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`);
  await page.screenshot({ path: path.join(OUT, '00-login.png'), fullPage: true });
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);

  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as {
    id: number; invoiceNumber: number | null; status: string; isCreditNote: boolean;
  }[];
  const expenses = (await (await ctx.request.get(`${BASE}/api/expenses`)).json()) as { id: number; voucherNumber: number }[];
  const customers = (await (await ctx.request.get(`${BASE}/api/customers`)).json()) as { id: number }[];

  const issued = invoices.find((i) => i.invoiceNumber === 1001) ?? invoices.find((i) => i.status === 'issued');
  const creditNote = invoices.find((i) => i.isCreditNote);
  const firstExpense = expenses.find((e) => e.voucherNumber === 1) ?? expenses[0];
  const firstCustomer = customers[0];

  // A fresh draft for the editor screen (deleted again afterwards).
  const draftRes = await ctx.request.post(`${BASE}/api/invoices`, { data: { customerId: firstCustomer.id } });
  const draft = (await draftRes.json()) as { id: number };
  await ctx.request.put(`${BASE}/api/invoices/${draft.id}`, {
    data: {
      customerId: firstCustomer.id,
      issueDate: '2026-09-07',
      dueDate: '2026-09-21',
      paymentReference: 'Reg. 1234 Konto 1234567890',
      lines: [
        { description: 'Konceptudvikling, uge 36', quantity: 12, unit: 'time', unitPriceOre: 95000 },
        { description: 'Transport, Kbh–Aarhus', quantity: 1, unit: 'stk.', unitPriceOre: 120000 }
      ]
    }
  });

  const shots: [string, string][] = [
    ['01-dashboard', '/'],
    ['02-fakturaer', '/fakturaer'],
    ['03-faktura-kladde', `/fakturaer/${draft.id}`],
    ['04-faktura-udstedt', `/fakturaer/${issued?.id}`],
    ['05-kreditnota', `/fakturaer/${creditNote?.id}`],
    ['06-udgifter', '/udgifter'],
    ['07-udgift-bilag', `/udgifter/${firstExpense?.id}`],
    ['08-moms', '/moms?year=2026&quarter=3'],
    ['09-kunder', '/kunder'],
    ['10-kunde', `/kunder/${firstCustomer.id}`],
    ['11-indstillinger', '/indstillinger'],
    ['12-eksport', '/eksport'],
    ['15-resultat', '/resultat?year=2026'],
    ['16-cashflow', '/cashflow'],
    ['17-balance', '/balance']
  ];
  for (const [name, url] of shots) {
    await page.goto(`${BASE}${url}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log('shot', name);
  }

  // Editor with the confirm step open.
  await page.goto(`${BASE}/fakturaer/${draft.id}`);
  await page.click('button.btn--primary:has-text("Udsted")');
  await page.screenshot({ path: path.join(OUT, '03b-faktura-udsted-bekraeft.png'), fullPage: true });
  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);

  // Issued PDF rendered to PNG (page 1) via pdf-parse.
  for (const [name, inv] of [
    ['13-pdf-faktura-1001', issued],
    ['14-pdf-kreditnota', creditNote]
  ] as const) {
    if (!inv) continue;
    const pdf = await (await ctx.request.get(`${BASE}/api/invoices/${inv.id}/pdf`)).body();
    const parser = new PDFParse({ data: pdf });
    const shot = await parser.getScreenshot({ scale: 2, first: 1 });
    const png = shot.pages[0]?.data;
    if (png) fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png));
    console.log('shot', name);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
