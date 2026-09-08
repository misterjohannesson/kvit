/**
 * Screenshots for the product site (site/img/*.png), taken from a running, seeded app.
 *
 *   BASE_URL=http://127.0.0.1:3125 APP_PASSWORD=test1234 npx tsx scripts/site-shots.ts
 *
 * 1280x800 viewport shots of the screens the homepage talks about, plus the issued
 * invoice PDF rendered to an image. Deterministic names so the HTML can reference them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFParse } from 'pdf-parse';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3125';
const PASSWORD = process.env.APP_PASSWORD ?? 'test1234';
const OUT = path.join(process.cwd(), 'site', 'img');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);

  const shot = async (name: string, url: string, settle = 300) => {
    await page.goto(`${BASE}${url}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(settle);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('shot', name);
  };

  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as { id: number; invoiceNumber: number | null; status: string }[];
  const issued = invoices.find((i) => i.invoiceNumber === 1001)!;
  const customers = (await (await ctx.request.get(`${BASE}/api/customers`)).json()) as { id: number }[];

  await shot('overblik', '/');
  await shot('fakturaer', '/fakturaer');
  await shot('faktura', `/fakturaer/${issued.id}`, 1500);

  // A draft with two lines for the editor screen; removed again afterwards.
  const draft = (await (
    await ctx.request.post(`${BASE}/api/invoices`, {
      data: {
        customerId: customers[0].id,
        lines: [
          { description: 'Konceptudvikling, uge 36–37', quantity: 24, unit: 'time', unitPriceOre: 95000 },
          { description: 'Workshop, designsystem', quantity: 1, unit: 'stk.', unitPriceOre: 850000 }
        ]
      }
    })
  ).json()) as { id: number };
  await shot('kladde', `/fakturaer/${draft.id}`);
  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);

  await shot('udgifter', '/udgifter');
  await shot('moms', '/moms');
  await shot('cashflow', '/cashflow');
  await shot('balance', '/balance');

  // The issued PDF, rendered to an image (page 1).
  const pdf = await (await ctx.request.get(`${BASE}/api/invoices/${issued.id}/pdf`)).body();
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  const img = await parser.getScreenshot({ scale: 1.6, first: 1, last: 1 });
  await parser.destroy();
  const first = img.pages[0];
  if (first?.data) fs.writeFileSync(path.join(OUT, 'faktura-pdf.png'), Buffer.from(first.data));
  console.log('shot faktura-pdf');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
