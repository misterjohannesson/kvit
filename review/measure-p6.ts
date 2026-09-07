/**
 * Pass 6 probe: verification of E1-E3 (commit 841fa27) and the side effects of
 * moving `table.data td.wrap` from moms/+page.svelte into app.css.
 *  - Export `Indhold` table at 1440 / 1280 / 1152: table vs `.table-wrap`,
 *    hidden px, the `Rækker` header and every `Rækker` cell's right edge vs the
 *    wrap's right edge, computed white-space per column, line count of the
 *    wrapped prose cells (E1).
 *  - Issued-invoice detail Kunde cell at 1440 / 1280 / 1152: grouped CVR line
 *    boxes and computed white-space (E2). Kunder list CVR cell likewise.
 *  - Moms sales and purchases tables at 1440 / 1152: td.wrap still `normal`,
 *    no hidden px (regression check for the moved rule).
 *  - example.html opened from disk at 1440 / 1419 / 1152: the "Ny faktura"
 *    demo's grid columns and its line table vs its panel (E3).
 * Writes shots 44 (Kunder 1152), 45 (Moms 1152), 46 (example.html demo 1152).
 * Reads only; creates no data. Usage:
 * BASE_URL=http://127.0.0.1:3108 APP_PASSWORD=review1234 npx tsx review/measure-p6.ts
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3108';
const PASSWORD = process.env.APP_PASSWORD ?? 'review1234';
const OUT = path.join(process.cwd(), 'review', 'shots');

// `pick` is a JS expression evaluating to the table element.
const TABLE = (pick: string) => `(() => {
  const t = ${pick}; if (!t) return 'no table';
  const w = t.closest('.table-wrap');
  const wr = Math.round(w.getBoundingClientRect().right);
  const ws = (el) => getComputedStyle(el).whiteSpace;
  const rows = Array.from(t.querySelectorAll('tbody tr'));
  const numCells = rows.flatMap((r) => Array.from(r.querySelectorAll('td.num')));
  const wrapCells = rows.map((r) => r.querySelector('td.wrap')).filter(Boolean);
  const lineH = wrapCells[0] ? parseFloat(getComputedStyle(wrapCells[0]).lineHeight) : 0;
  const padY = wrapCells[0] ? parseFloat(getComputedStyle(wrapCells[0]).paddingTop) + parseFloat(getComputedStyle(wrapCells[0]).paddingBottom) : 0;
  return { vw: innerWidth, tableW: Math.round(t.getBoundingClientRect().width), wrapClientW: w.clientWidth, wrapScrollW: w.scrollWidth,
    hiddenPx: Math.max(0, w.scrollWidth - w.clientWidth), wrapRight: wr,
    cols: Array.from(t.querRemoveMe.querySelectorAll('thead th')).map((th) => th.textContent.trim() + '=' + Math.round(th.getBoundingClientRect().width) + ' right=' + Math.round(th.getBoundingClientRect().right) + ' ' + ws(th)),
    numCells: numCells.map((c) => ({ text: c.textContent.trim(), right: Math.round(c.getBoundingClientRect().right), insideWrap: Math.round(c.getBoundingClientRect().right) <= wr, ws: ws(c) })),
    wrapCells: wrapCells.map((c) => { const sub = c.querySelector('.cell-sub'); const h = c.getBoundingClientRect().height - padY - (sub ? sub.getBoundingClientRect().height : 0); return { ws: ws(c), lines: lineH ? Math.round(h / lineH) : null, w: Math.round(c.getBoundingClientRect().width) }; }),
    firstColWs: rows[0] ? ws(rows[0].querySelector('td')) : null,
    docHScroll: document.documentElement.scrollWidth > innerWidth };
})()`.replace('t.querRemoveMe.querySelectorAll', 't.querySelectorAll');

const CVR = (sel: string) => `(() => {
  const els = Array.from(document.querySelectorAll('${sel}'));
  if (!els.length) return 'no ${sel}';
  return { vw: innerWidth, items: els.map((cvr) => ({ text: cvr.textContent.trim(), lineBoxes: cvr.getClientRects().length, ws: getComputedStyle(cvr).whiteSpace,
    font: getComputedStyle(cvr).fontFamily.split(',')[0], rects: Array.from(cvr.getClientRects()).map((r) => ({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) })),
    parentW: Math.round(cvr.parentElement.getBoundingClientRect().width), parentH: Math.round(cvr.parentElement.getBoundingClientRect().height),
    parentText: JSON.stringify(cvr.parentElement.textContent) })) };
})()`;

const DEMO = `(() => {
  const g = document.querySelector('.layout-8-4.layout-8-4--lines'); if (!g) return 'no demo grid';
  const kids = Array.from(g.children);
  const table = g.querySelector('table.lines') || g.querySelector('fieldset table'); const panel = table && table.closest('.panel'); const body = table && table.closest('.panel__body');
  const first = kids[0].getBoundingClientRect(), second = kids[1].getBoundingClientRect();
  return { vw: innerWidth, classes: g.className, gridCols: getComputedStyle(g).gridTemplateColumns,
    stacked: second.top >= first.bottom - 1, sideBySide: second.left >= first.right - 1,
    tableW: table ? Math.round(table.getBoundingClientRect().width) : null,
    tableExceedsPanel: table ? Math.round(table.getBoundingClientRect().right) - Math.round(panel.getBoundingClientRect().right) : null,
    tableExceedsBody: table ? Math.round(table.getBoundingClientRect().right) - Math.round(body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight)) : null,
    fieldsetMinWidth: table ? getComputedStyle(table.closest('fieldset')).minWidth : null,
    plainGrids: Array.from(document.querySelectorAll('.layout-8-4:not(.layout-8-4--lines)')).map((p) => getComputedStyle(p).gridTemplateColumns),
    nowrapRule: (() => { const s = document.createElement('span'); s.className = 'nowrap'; document.body.appendChild(s); const v = getComputedStyle(s).whiteSpace; s.remove(); return v; })(),
    wrapRule: (() => { const tb = document.createElement('table'); tb.className = 'data'; const td = document.createElement('td'); td.className = 'wrap'; tb.appendChild(document.createElement('tbody')).appendChild(document.createElement('tr')).appendChild(td); document.body.appendChild(tb); const v = getComputedStyle(td).whiteSpace; tb.remove(); return v; })(),
    docHScroll: document.documentElement.scrollWidth > innerWidth };
})()`;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);
  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as { id: number; invoiceNumber: number | null }[];
  const issued = invoices.find((i) => i.invoiceNumber === 1001)!;

  for (const w of [1440, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/eksport`);
    await page.waitForSelector('.layout-8-4 table.data');
    console.log(`== E1 export table @${w}`, JSON.stringify(await page.evaluate(TABLE("document.querySelector('.layout-8-4 table.data')"))));
    await page.goto(`${BASE}/fakturaer/${issued.id}`);
    await page.waitForSelector('.facts');
    console.log(`== E2 detail CVR @${w}`, JSON.stringify(await page.evaluate(CVR('.facts .cell-sub .mono'))));
    await page.goto(`${BASE}/kunder`);
    await page.waitForSelector('table.data');
    console.log(`== kunder CVR @${w}`, JSON.stringify(await page.evaluate(CVR('table.data td.mono'))));
    if (w === 1152) await page.screenshot({ path: path.join(OUT, '44-kunder-1152.png'), fullPage: true });
    {
      await page.goto(`${BASE}/moms`);
      await page.waitForSelector('table.data');
      const n = await page.locator('table.data').count();
      for (let i = 0; i < n; i++) console.log(`== moms table ${i} @${w}`, JSON.stringify(await page.evaluate(TABLE(`document.querySelectorAll('table.data')[${i}]`))));
      if (w === 1152) await page.screenshot({ path: path.join(OUT, '45-moms-1152.png'), fullPage: true });
    }
  }

  // E3: the reference's own demo, rendered from disk.
  const ex = pathToFileURL(path.join(process.cwd(), 'example.html')).href;
  for (const w of [1440, 1419, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(ex);
    await page.waitForSelector('.layout-8-4');
    console.log(`== E3 example.html demo @${w}`, JSON.stringify(await page.evaluate(DEMO)));
    if (w === 1152) {
      const box = await page.locator('.layout-8-4.layout-8-4--lines').boundingBox();
      if (box) await page.screenshot({ path: path.join(OUT, '46-example-ny-faktura-1152.png'), fullPage: true, clip: { x: 0, y: Math.max(0, box.y - 80), width: w, height: Math.min(box.height + 120, 1400) } });
    }
  }
  console.log('shots 44, 45, 46 written');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
