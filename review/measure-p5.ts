/**
 * Pass 5 probe: the `.layout-8-4--lines` scoping (commit 64f3e22).
 * For the line editor, the issued-invoice detail, the expense detail and the
 * export page at 1440 / 1419 / 1280 / 1152 px: grid columns, side-by-side vs
 * stacked, panel geometry, page-level horizontal scroll; for the editor also
 * table-vs-panel overflow and input widths. Then two content checks on the
 * pages that now stay side by side below 1420: the export `Indhold` table
 * against its `.table-wrap` (E1) and the grouped CVR's line boxes in the
 * detail page's Kunde cell (E2). Writes shots 40-43 and the two zoom crops.
 * Usage: BASE_URL=http://127.0.0.1:3108 APP_PASSWORD=review1234 npx tsx review/measure-p5.ts
 */
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3108';
const PASSWORD = process.env.APP_PASSWORD ?? 'review1234';
const OUT = path.join(process.cwd(), 'review', 'shots');

const LAYOUT = `(() => {
  const g = document.querySelector('.layout-8-4');
  if (!g) return 'no .layout-8-4';
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), w: Math.round(b.width) }; };
  const kids = Array.from(g.children).filter((k) => k.tagName !== 'INPUT');
  const table = document.querySelector('table.lines');
  let lines = null;
  if (table) {
    const body = table.closest('.panel__body'); const panel = table.closest('.panel');
    lines = {
      tableW: Math.round(table.getBoundingClientRect().width),
      exceedsPanel: Math.round(table.getBoundingClientRect().right) - Math.round(panel.getBoundingClientRect().right),
      exceedsBody: Math.round(table.getBoundingClientRect().right) - Math.round(body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight)),
      inputs: ['Beskrivelse', 'Antal', 'Enhed', 'Pris'].map((k) => { const i = document.querySelector('input[aria-label^="' + k + '"]'); return i ? k + '=' + Math.round(i.getBoundingClientRect().width) + (i.scrollWidth > i.clientWidth ? ' CLIPPED' : '') : k + '=?'; })
    };
  }
  const escaping = kids.flatMap((p) => Array.from(p.querySelectorAll('*')).filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > p.getBoundingClientRect().right + 1 && !e.closest('.table-wrap')).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)));
  const first = kids[0].getBoundingClientRect(), second = kids[1] ? kids[1].getBoundingClientRect() : null;
  return {
    vw: innerWidth, classes: g.className, gridCols: getComputedStyle(g).gridTemplateColumns,
    sideBySide: second ? second.left >= first.right - 1 && Math.abs(second.top - first.top) < 2 : null,
    stacked: second ? second.top >= first.bottom - 1 : null,
    panels: kids.map(r), lines, escapingPanel: escaping.slice(0, 8),
    docScrollW: document.documentElement.scrollWidth, hScroll: document.documentElement.scrollWidth > innerWidth
  };
})()`;

const EXPORT_TABLE = `(() => {
  const t = document.querySelector('.layout-8-4 table.data'); const w = t.parentElement;
  return { vw: innerWidth, wrapTag: w.className, wrapClientW: w.clientWidth, wrapScrollW: w.scrollWidth, tableW: Math.round(t.getBoundingClientRect().width),
    cols: Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent.trim() + '=' + Math.round(th.getBoundingClientRect().width) + ' ' + getComputedStyle(th).whiteSpace),
    lastColRight: Math.round(t.querySelector('th.num').getBoundingClientRect().right), wrapRight: Math.round(w.getBoundingClientRect().right),
    hiddenPx: Math.max(0, w.scrollWidth - w.clientWidth), scrollbarPx: w.offsetHeight - w.clientHeight };
})()`;

const CVR = `(() => {
  const cvr = document.querySelector('.facts .cell-sub .mono');
  if (!cvr) return 'no CVR span';
  const rects = Array.from(cvr.getClientRects()).map((r) => ({ t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width) }));
  return { vw: innerWidth, text: cvr.textContent, lineBoxes: rects.length, rects, ws: getComputedStyle(cvr).whiteSpace, cellSubW: Math.round(cvr.parentElement.getBoundingClientRect().width), cellSubH: Math.round(cvr.parentElement.getBoundingClientRect().height) };
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
  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as { id: number; invoiceNumber: number | null }[];
  const expenses = (await (await ctx.request.get(`${BASE}/api/expenses`)).json()) as { id: number; voucherNumber: number }[];
  const issued = invoices.find((i) => i.invoiceNumber === 1001)!;
  const expense = expenses.find((e) => e.voucherNumber === 1) ?? expenses[0];

  const pages: [string, string][] = [
    ['editor (draft)', `/fakturaer/${draft.id}`],
    ['issued detail 1001', `/fakturaer/${issued.id}`],
    ['expense detail', `/udgifter/${expense.id}`],
    ['export', '/eksport']
  ];
  for (const w of [1440, 1419, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const [name, url] of pages) {
      await page.goto(`${BASE}${url}`);
      await page.waitForSelector('.layout-8-4');
      console.log(`== ${name} @${w}`, JSON.stringify(await page.evaluate(LAYOUT)));
    }
    console.log('');
  }
  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);

  // E1: export table vs its wrap; E2: CVR line boxes on the detail page.
  for (const w of [1440, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/eksport`);
    await page.waitForSelector('.layout-8-4 table.data');
    console.log(`== export table @${w}`, JSON.stringify(await page.evaluate(EXPORT_TABLE)));
    if (w === 1280) await page.screenshot({ path: path.join(OUT, '43-eksport-1280.png'), fullPage: true });
    if (w === 1152) {
      await page.screenshot({ path: path.join(OUT, '42-eksport-1152.png'), fullPage: true });
      const tb = await page.locator('.layout-8-4 .table-wrap').boundingBox();
      if (tb) await page.screenshot({ path: path.join(OUT, '42b-eksport-1152-tabel-zoom.png'), clip: { x: tb.x - 8, y: tb.y - 8, width: tb.width + 16, height: tb.height + 24 } });
    }
    await page.goto(`${BASE}/fakturaer/${issued.id}`);
    await page.waitForSelector('.facts');
    console.log(`== detail CVR @${w}`, JSON.stringify(await page.evaluate(CVR)));
    if (w === 1152) {
      await page.screenshot({ path: path.join(OUT, '40-faktura-udstedt-1152.png'), fullPage: true });
      const box = await page.locator('.layout-8-4 .panel__body').first().boundingBox();
      if (box) await page.screenshot({ path: path.join(OUT, '40b-faktura-udstedt-1152-kunde-zoom.png'), clip: { x: box.x, y: box.y, width: Math.min(box.width, 560), height: 120 } });
      await page.goto(`${BASE}/udgifter/${expense.id}`);
      await page.waitForSelector('.layout-8-4');
      await page.screenshot({ path: path.join(OUT, '41-udgift-bilag-1152.png'), fullPage: true });
    }
  }
  console.log('shots 40, 40b, 41, 42, 42b, 43 written');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
