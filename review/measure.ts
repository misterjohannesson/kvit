/**
 * Computed-style checks for pass 2 of the design review (no screenshots).
 * Evaluate bodies are passed as strings because tsx/esbuild injects a __name helper
 * into serialised arrow functions.
 * Usage: BASE_URL=http://127.0.0.1:3102 APP_PASSWORD=... npx tsx review/measure.ts
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3101';
const PASSWORD = process.env.APP_PASSWORD ?? 'test1234';

const SEGMENT = `(() => {
  const f = document.querySelector('form[action="/density"]');
  const first = f.firstElementChild;
  const normal = f.querySelector('button[value=normal]');
  const alle = document.querySelector('.segment > a');
  const cs = (el) => getComputedStyle(el);
  return {
    firstChildTag: first.tagName, firstChildDisplay: cs(first).display,
    normalBorderLeft: cs(normal).borderLeftWidth + ' ' + cs(normal).borderLeftColor,
    linkSegmentFirstBorderLeft: cs(alle).borderLeftWidth,
    segmentBorder: cs(f).borderLeftWidth + ' ' + cs(f).borderLeftColor,
    normalHeight: normal.getBoundingClientRect().height, normalFont: cs(normal).fontFamily.slice(0, 40)
  };
})()`;

const EMPTY = `(() => {
  const td = document.querySelector('td.empty');
  if (!td) return 'no td.empty';
  const cs = getComputedStyle(td);
  return { textAlign: cs.textAlign, padding: cs.padding, color: cs.color, fontSize: cs.fontSize };
})()`;

const LINES = `(() => {
  const q = document.querySelector('input[aria-label^="Antal"]');
  const u = document.querySelector('input[aria-label^="Enhed"]');
  const p = document.querySelector('input[aria-label^="Pris"]');
  const d = document.querySelector('input[aria-label^="Beskrivelse"]');
  const bw = (el) => Math.round(el.getBoundingClientRect().width);
  return { qty: bw(q), unit: bw(u), price: bw(p), desc: bw(d), qtyScrollW: q.scrollWidth, qtyClientW: q.clientWidth };
})()`;

const BADGE = `(() => {
  const el = document.querySelector('.panel__head .badge');
  const cs = getComputedStyle(el);
  const cvr = document.querySelector('.facts .cell-sub .mono');
  return { badgeFont: cs.fontFamily.slice(0, 40), cvrText: cvr ? cvr.textContent : null, cvrFont: cvr ? getComputedStyle(cvr).fontFamily.slice(0, 30) : null };
})()`;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);

  await page.goto(`${BASE}/fakturaer`);
  console.log('density segment', JSON.stringify(await page.evaluate(SEGMENT)));

  const customers = (await (await ctx.request.get(`${BASE}/api/customers`)).json()) as { id: number }[];

  // Empty state on a customer with no invoices (the invoice list filters may not be empty while other tests run).
  const custRes = await ctx.request.post(`${BASE}/api/customers`, {
    data: { name: 'Review Måling ApS', address: 'Testvej 2', zip: '8000', city: 'Aarhus C', country: 'DK' }
  });
  if (custRes.ok()) {
    const cust = (await custRes.json()) as { id: number };
    await page.goto(`${BASE}/kunder/${cust.id}`);
    console.log('td.empty', JSON.stringify(await page.evaluate(EMPTY)));
    await ctx.request.delete(`${BASE}/api/customers/${cust.id}`);
  }
  const draft = (await (await ctx.request.post(`${BASE}/api/invoices`, { data: { customerId: customers[0].id } })).json()) as { id: number };
  for (const w of [1440, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/fakturaer/${draft.id}`);
    console.log(`editor line inputs @${w}`, JSON.stringify(await page.evaluate(LINES)));
  }
  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);

  await page.setViewportSize({ width: 1440, height: 900 });

  // 5. Editor after a failed save: disabled primary styling and duplicated error text.
  const draft2 = (await (await ctx.request.post(`${BASE}/api/invoices`, { data: { customerId: customers[0].id } })).json()) as { id: number };
  await page.goto(`${BASE}/fakturaer/${draft2.id}`);
  await page.fill('input[aria-label="Beskrivelse, linje 1"]', 'Rådgivning');
  await page.fill('input[aria-label="Pris, linje 1"]', '1.000,00');
  await page.fill('#issueDate', 'abc');
  await page.click('button.btn:has-text("Gem kladde")');
  await page.waitForSelector('.field--error', { timeout: 10000 });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500); // let the 80 ms button transition finish
  console.log('editor error state', JSON.stringify(await page.evaluate(`(() => {
    const b = document.querySelector('button.btn--primary');
    const cs = getComputedStyle(b);
    const errs = Array.from(document.querySelectorAll('.error')).map((e) => e.className + ' | ' + e.textContent.trim());
    return { disabled: b.disabled, bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, errors: errs };
  })()`)));
  await ctx.request.delete(`${BASE}/api/invoices/${draft2.id}`);

  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as { id: number; invoiceNumber: number | null }[];
  const inv = invoices.find((i) => i.invoiceNumber === 1001);
  if (inv) {
    await page.goto(`${BASE}/fakturaer/${inv.id}`);
    console.log('badge/cvr', JSON.stringify(await page.evaluate(BADGE)));
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
