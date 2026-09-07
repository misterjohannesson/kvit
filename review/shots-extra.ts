/**
 * Additional review states not covered by shots.ts: login error, filtered and
 * empty invoice lists, 404 page, expense form per-field validation errors,
 * credit-note confirm step (.confirmbox), paid-invoice detail, row hover,
 * Kompakt density on Fakturaer/Udgifter, editor date-field error, empty
 * customer detail, toolbar zoom and the 1152px minimum width.
 *
 * Usage: BASE_URL=http://127.0.0.1:3102 APP_PASSWORD=... npx tsx review/shots-extra.ts
 * Output: review/shots/2x-*.png and 3x-*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3101';
const PASSWORD = process.env.APP_PASSWORD ?? 'test1234';
const OUT = path.join(process.cwd(), 'review', 'shots');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const log = (n: string) => console.log('shot', n);

  // Login: wrong password -> field error state.
  await page.goto(`${BASE}/login`);
  await page.fill('#password', 'forkert');
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
  await shot('20-login-fejl'); log('20');

  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);

  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as {
    id: number; invoiceNumber: number | null; status: string; isCreditNote: boolean; paidDate: string | null;
  }[];
  const customers = (await (await ctx.request.get(`${BASE}/api/customers`)).json()) as { id: number }[];

  // Filtered lists.
  for (const [name, status] of [
    ['21-fakturaer-forfaldne', 'forfaldne'],
    ['22-fakturaer-kladder', 'kladder'],
    ['23-fakturaer-krediterede', 'krediterede']
  ] as const) {
    await page.goto(`${BASE}/fakturaer?status=${status}`);
    await page.waitForLoadState('networkidle');
    await shot(name); log(name);
  }

  // Row hover on the invoice list.
  await page.goto(`${BASE}/fakturaer`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('table.data tbody tr').nth(1);
  await row.hover();
  await page.screenshot({ path: path.join(OUT, '24-fakturaer-hover.png'), fullPage: false }); log('24');

  // 404 error page.
  await page.goto(`${BASE}/fakturaer/999999`);
  await page.waitForLoadState('networkidle');
  await shot('25-fejlside-404'); log('25');

  // Expense form: invalid amount + invalid date -> per-field error states.
  await page.goto(`${BASE}/udgifter`);
  await page.fill('#date', '31.02.2026');
  await page.fill('#supplier', 'Test ApS');
  await page.fill('#category', 'Kontor');
  await page.fill('#description', 'Valideringstest');
  await page.fill('#amountExVat', 'abc');
  await page.fill('#vat', '0,00');
  await page.click('form[action="?/create"] button[type=submit]');
  await page.waitForLoadState('networkidle');
  await shot('26-udgift-valideringsfejl'); log('26');

  // Issued, uncredited, unpaid invoice: open the credit-note confirm step.
  const openInv = invoices.find((i) => i.status === 'issued' && !i.isCreditNote && !i.paidDate);
  if (openInv) {
    await page.goto(`${BASE}/fakturaer/${openInv.id}`);
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Opret kreditnota")');
    await page.waitForSelector('.confirmbox');
    await shot('27-faktura-kreditnota-bekraeft'); log('27');
  }

  // Paid invoice detail.
  const paidInv = invoices.find((i) => i.status === 'issued' && !i.isCreditNote && i.paidDate);
  if (paidInv) {
    await page.goto(`${BASE}/fakturaer/${paidInv.id}`);
    await page.waitForLoadState('networkidle');
    await shot('28-faktura-betalt'); log('28');
  }

  // A fresh draft for the editor states (deleted again afterwards).
  const draftRes = await ctx.request.post(`${BASE}/api/invoices`, { data: { customerId: customers[0].id } });
  const draft = (await draftRes.json()) as { id: number };

  // Kompakt density on Fakturaer and Udgifter (cookie via the segment form), then back to Normal.
  await page.goto(`${BASE}/fakturaer`);
  await page.waitForLoadState('networkidle');
  await page.locator('.toolbar').screenshot({ path: path.join(OUT, '33-fakturaer-toolbar-zoom.png') }); log('33');
  await page.click('form[action="/density"] button[value=dense]');
  await page.waitForLoadState('networkidle');
  await shot('31-fakturaer-kompakt'); log('31');
  await page.goto(`${BASE}/udgifter`);
  await page.waitForLoadState('networkidle');
  await shot('32-udgifter-kompakt'); log('32');
  await page.click('form[action="/density"] button[value=normal]');
  await page.waitForLoadState('networkidle');

  // Editor: valid line but invalid date on Gem kladde -> field error in the editor.
  await page.goto(`${BASE}/fakturaer/${draft.id}`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[aria-label="Beskrivelse, linje 1"]', 'Rådgivning');
  await page.fill('input[aria-label="Pris, linje 1"]', '1.000,00');
  await page.fill('#issueDate', 'abc');
  await page.click('button.btn:has-text("Gem kladde")');
  await page.waitForSelector('.field--error', { timeout: 10000 }).catch(() => {});
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300); // let the 80 ms button transitions settle
  await shot('34-faktura-kladde-datofejl'); log('34');

  // Expense detail: invalid amount on save -> field error in the stacked form.
  const expenses = (await (await ctx.request.get(`${BASE}/api/expenses`)).json()) as { id: number }[];
  if (expenses[0]) {
    await page.goto(`${BASE}/udgifter/${expenses[0].id}`);
    await page.waitForLoadState('networkidle');
    await page.fill('form[action="?/save"] #amountExVat', 'abc');
    await page.click('form[action="?/save"] button[type=submit]');
    await page.waitForLoadState('networkidle');
    await shot('36-udgift-bilag-fejl'); log('36');
  }

  // Customer without invoices -> empty state with its one secondary button.
  const custRes = await ctx.request.post(`${BASE}/api/customers`, {
    data: { name: 'Review Tom ApS', address: 'Testvej 1', zip: '8000', city: 'Aarhus C', country: 'DK' }
  });
  const cust = custRes.ok() ? ((await custRes.json()) as { id: number }) : null;
  if (cust) {
    await page.goto(`${BASE}/kunder/${cust.id}`);
    await page.waitForLoadState('networkidle');
    await shot('35-kunde-tom'); log('35');
    await ctx.request.delete(`${BASE}/api/customers/${cust.id}`);
  }

  // Minimum supported width (style.md §2: usable from 1152px).
  await page.setViewportSize({ width: 1152, height: 900 });
  await page.goto(`${BASE}/fakturaer`);
  await page.waitForLoadState('networkidle');
  await shot('29-fakturaer-1152'); log('29');
  await page.goto(`${BASE}/fakturaer/${draft.id}`);
  await page.waitForLoadState('networkidle');
  await shot('30-faktura-kladde-1152'); log('30');

  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
