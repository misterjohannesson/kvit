/**
 * Spec v2 — pass 4 probe (read-only; books nothing).
 *  /cashflow at 1440 / 1280 / 1152 (commit 9d7e7ba, finding 16):
 *   - every `.section__head p .mono` span in the "Pr. måned" intro: text + computed font-family;
 *   - the paragraph's own font-family and every bare text node in it that still carries a digit
 *     (an amount outside `.mono` would show up here);
 *   - the table geometry exactly as measure-v2p3.ts D recorded it (heads, cellSubs, hiddenPx, row heights,
 *     column widths, intro lines) so the two dumps can be compared 1:1;
 *   - page-level horizontal scroll, KPI sub.
 *  Shots: 16-cashflow (1440 full page), 67-cashflow-1280, 57-cashflow-1152, 65-cashflow-pr-maaned-zoom,
 *         71-cashflow-intro-zoom, 71b-cashflow-intro-1152-zoom, 71c-cashflow-kpis-1152-zoom.
 * Usage: BASE_URL=http://127.0.0.1:3110 APP_PASSWORD=review1234 npx tsx review/measure-v2p4.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3110';
const PASSWORD = process.env.APP_PASSWORD ?? 'review1234';
const OUT = path.join(process.cwd(), 'review', 'shots');
const LINES = `(el) => { const rg = document.createRange(); rg.selectNodeContents(el); const tops = new Set([...rg.getClientRects()].map((r) => Math.round(r.top))); return tops.size; }`;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.fill('#password', PASSWORD); await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`);
  const m: Record<string, unknown> = {};
  const shotNames: Record<number, string> = { 1440: '16-cashflow', 1280: '67-cashflow-1280', 1152: '57-cashflow-1152' };
  for (const w of [1440, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/cashflow`); await page.waitForLoadState('networkidle');
    m[String(w)] = await page.evaluate(`(() => { const lines = ${LINES}; const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim() === 'Pr. måned');
      const p = sec.querySelector('.section__head p'); const wrap = sec.querySelector('.table-wrap'); const t = wrap.querySelector('table');
      const kpi = [...document.querySelectorAll('.kpi')].find((k) => k.querySelector('.kpi__label')?.textContent.trim() === 'Åbningssaldo');
      const monos = [...p.querySelectorAll('.mono')].map((s) => ({ text: s.textContent.trim(), font: getComputedStyle(s).fontFamily, size: getComputedStyle(s).fontSize, weight: getComputedStyle(s).fontWeight, color: getComputedStyle(s).color, display: getComputedStyle(s).display }));
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); const bare = []; let n;
      while ((n = walker.nextNode())) { if (n.parentElement === p) bare.push(n.textContent); }
      const bareWithDigits = bare.filter((s) => /\d/.test(s));
      const pcs = getComputedStyle(p);
      const numericVar = getComputedStyle(document.documentElement).getPropertyValue('--font-numeric').trim();
      const sansVar = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim();
      return { monoCount: monos.length, monos, pFont: pcs.fontFamily, pSize: pcs.fontSize, pLineHeight: pcs.lineHeight, pColor: pcs.color, numericVar, sansVar,
        bareTextNodes: bare.length, bareWithDigits, intro: p.textContent.trim(), introLines: lines(p), introW: Math.round(p.getBoundingClientRect().width), introH: Math.round(p.getBoundingClientRect().height), introMaxW: pcs.maxWidth,
        heads: [...t.tHead.rows[0].cells].map((c) => c.textContent.trim()), cellSubs: t.querySelectorAll('.cell-sub').length, wrap: wrap.clientWidth, table: Math.round(t.getBoundingClientRect().width), hiddenPx: wrap.scrollWidth - wrap.clientWidth,
        rowHeights: [...t.tBodies[0].rows].map((r) => Math.round(r.getBoundingClientRect().height)), rows: [...t.tBodies[0].rows].map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' | ')),
        foot: t.tFoot ? [...t.tFoot.rows[0].cells].map((c) => c.textContent.trim()).join(' | ') : null,
        colWidths: [...t.tBodies[0].rows[0].cells].map((c) => Math.round(c.getBoundingClientRect().width)),
        numCells: [...t.querySelectorAll('.num')].length, numNotRight: [...t.querySelectorAll('.num')].filter((c) => getComputedStyle(c).textAlign !== 'right').length,
        numFontsNotMono: [...t.querySelectorAll('td.num')].filter((c) => !getComputedStyle(c).fontFamily.startsWith('ui-monospace')).length,
        otherTables: [...document.querySelectorAll('.table-wrap')].map((wr) => ({ cols: wr.querySelector('table')?.tHead?.rows[0].cells.length, hiddenPx: wr.scrollWidth - wr.clientWidth })),
        pageHScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        kpiSub: kpi ? kpi.querySelector('.kpi__sub').textContent.trim() : null, kpiSubLines: kpi ? lines(kpi.querySelector('.kpi__sub')) : null, kpiW: kpi ? Math.round(kpi.getBoundingClientRect().width) : null }; })()`);
    await page.screenshot({ path: path.join(OUT, `${shotNames[w]}.png`), fullPage: true }); console.log('shot', shotNames[w]);
    if (w === 1440) {
      await page.locator('section:has(h2:has-text("Pr. måned")) .section__head').screenshot({ path: path.join(OUT, '71-cashflow-intro-zoom.png') }); console.log('shot 71');
      await page.locator('section:has(h2:has-text("Pr. måned")) .panel').screenshot({ path: path.join(OUT, '65-cashflow-pr-maaned-zoom.png') }); console.log('shot 65');
    }
    if (w === 1152) {
      await page.locator('section:has(h2:has-text("Pr. måned")) .section__head').screenshot({ path: path.join(OUT, '71b-cashflow-intro-1152-zoom.png') }); console.log('shot 71b');
      await page.locator('.kpis').first().screenshot({ path: path.join(OUT, '71c-cashflow-kpis-1152-zoom.png') }); console.log('shot 71c');
    }
  }
  fs.writeFileSync(path.join(OUT, '..', 'measure-v2p4.json'), JSON.stringify(m, null, 2));
  console.log(JSON.stringify(m, null, 2));
  await browser.close();
})();
