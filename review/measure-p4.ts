/**
 * Pass 4 geometry probe: line-item table vs its panel in the invoice editor at
 * 1440 / 1420 / 1280 / 1152 px, the 8/4 split collapse, cell padding, and the
 * layout of the other .layout-8-4 pages. Also takes shot 37 (editor at 1280 px).
 * Usage: BASE_URL=http://127.0.0.1:3108 APP_PASSWORD=review1234 npx tsx review/measure-p4.ts
 */
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3108';
const PASSWORD = process.env.APP_PASSWORD ?? 'review1234';
const OUT = path.join(process.cwd(), 'review', 'shots');

const GEOM = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
  const form = document.querySelector('form.layout-8-4');
  const panels = Array.from(form.querySelectorAll(':scope > .panel'));
  const table = document.querySelector('table.lines');
  const wrap = table.closest('.table-wrap');
  const fs = table.closest('fieldset');
  const body = table.closest('.panel__body');
  const linesPanel = table.closest('.panel');
  const summary = panels.find((p) => p !== linesPanel);
  const cols = Array.from(table.querySelectorAll('tbody tr:first-child td')).map((td) => Math.round(td.getBoundingClientRect().width));
  const td = table.querySelector('tbody td');
  const th = table.querySelector('thead th');
  const confirm = document.querySelector('.confirmbox');
  return {
    viewport: innerWidth,
    gridCols: getComputedStyle(form).gridTemplateColumns,
    stacked: summary.getBoundingClientRect().top >= linesPanel.getBoundingClientRect().bottom - 1,
    linesPanel: r(linesPanel), summaryPanel: r(summary),
    panelBodyInner: Math.round(body.clientWidth - parseFloat(getComputedStyle(body).paddingLeft) - parseFloat(getComputedStyle(body).paddingRight)),
    fieldset: r(fs), fieldsetMinWidth: getComputedStyle(fs).minWidth,
    wrap: r(wrap), wrapScrollW: wrap.scrollWidth, wrapClientW: wrap.clientWidth, wrapOverflowX: getComputedStyle(wrap).overflowX,
    table: r(table), cols,
    tableExceedsPanel: Math.round(table.getBoundingClientRect().right) - Math.round(linesPanel.getBoundingClientRect().right),
    tableExceedsBody: Math.round(table.getBoundingClientRect().right) - Math.round(body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight)),
    tdPadding: getComputedStyle(td).padding, thPadding: getComputedStyle(th).padding,
    inputs: ['Beskrivelse', 'Antal', 'Enhed', 'Pris'].map((k) => { const i = document.querySelector('input[aria-label^="' + k + '"]'); return k + '=' + Math.round(i.getBoundingClientRect().width) + (i.scrollWidth > i.clientWidth ? ' CLIPPED' : ''); }),
    confirm: confirm ? r(confirm) : null,
    docScrollW: document.documentElement.scrollWidth
  };
})()`;

const OTHER = `(() => {
  const g = document.querySelector('.layout-8-4');
  if (!g) return 'no .layout-8-4';
  const kids = Array.from(g.children).map((k) => { const b = k.getBoundingClientRect(); return { cls: k.className.slice(0, 20), l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), w: Math.round(b.width) }; });
  return { gridCols: getComputedStyle(g).gridTemplateColumns, kids, docScrollW: document.documentElement.scrollWidth, vw: innerWidth };
})()`;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);

  const customers = (await (await ctx.request.get(`${BASE}/api/customers`)).json()) as { id: number }[];
  const draft = (await (await ctx.request.post(`${BASE}/api/invoices`, { data: { customerId: customers[0].id } })).json()) as { id: number };
  await ctx.request.put(`${BASE}/api/invoices/${draft.id}`, {
    data: {
      customerId: customers[0].id, issueDate: '2026-09-07', dueDate: '2026-09-21', paymentReference: 'Reg. 1234 Konto 1234567890',
      lines: [{ description: 'Konceptudvikling, uge 36', quantity: 12, unit: 'time', unitPriceOre: 95000 }]
    }
  });

  for (const w of [1440, 1420, 1419, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/fakturaer/${draft.id}`);
    await page.waitForSelector('table.lines');
    console.log(`\n== editor @${w}`, JSON.stringify(await page.evaluate(GEOM), null, 0));
    if (w === 1280) {
      await page.screenshot({ path: path.join(OUT, '37-faktura-kladde-1280.png'), fullPage: true });
      console.log('shot 37 written');
    }
    if (w === 1440 || w === 1152) {
      // Confirm step open: the table must not cover the confirm box.
      const btn = page.locator('button.btn--primary:has-text("Udsted")');
      if (await btn.isEnabled()) {
        await btn.click();
        await page.waitForSelector('.confirmbox');
        console.log(`== editor confirm open @${w}`, JSON.stringify(await page.evaluate(GEOM), null, 0));
        if (w === 1152) {
          await page.screenshot({ path: path.join(OUT, '38-faktura-udsted-bekraeft-1152.png'), fullPage: true });
          console.log('shot 38 written');
        }
      } else {
        console.log('Udsted disabled at', w);
      }
    }
  }
  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);

  // Other 8/4 pages: issued invoice detail, expense detail, export.
  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as { id: number; invoiceNumber: number | null }[];
  const expenses = (await (await ctx.request.get(`${BASE}/api/expenses`)).json()) as { id: number }[];
  const issued = invoices.find((i) => i.invoiceNumber === 1001);
  const pages = [
    ['fakturaer/[id]', `/fakturaer/${issued?.id}`],
    ['udgifter/[id]', `/udgifter/${expenses[0]?.id}`],
    ['eksport', '/eksport']
  ];
  for (const w of [1440, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const [name, url] of pages) {
      await page.goto(`${BASE}${url}`);
      console.log(`\n== ${name} @${w}`, JSON.stringify(await page.evaluate(OTHER)));
    }
    if (w === 1280) {
      await page.goto(`${BASE}/fakturaer/${issued?.id}`);
      await page.screenshot({ path: path.join(OUT, '39-faktura-udstedt-1280.png'), fullPage: true });
      console.log('shot 39 written');
    }
  }

  // Kunder list CVR (P2).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/kunder`);
  console.log('\n== kunder CVR cells', JSON.stringify(await page.evaluate(`Array.from(document.querySelectorAll('table.data tbody td.mono')).map((t) => t.textContent.trim() + ' | ' + getComputedStyle(t).fontFamily.slice(0, 25))`)));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
