/**
 * Spec v2 — pass 5 probe (commit 48f1eed, finding 17). Reversible: moves the opening-balance date forward
 * via PUT /api/settings so the "bevægelser dateret før åbningssaldoen" branch of the /cashflow intro renders,
 * measures it, then restores the original date (in a finally block). Books nothing.
 *  Phase A (original date): /cashflow at 1440 — the pass-4 fields, for parity (monoCount 5, geometry).
 *  Phase B (opening_balance_date = 2026-05-01): /cashflow at 1440 / 1280 / 1152 — every `.section__head p .mono`
 *    span with computed font-family, the paragraph's own font-family, bare text nodes still carrying a digit,
 *    the table geometry fields of measure-v2p4.ts; shot 74-cashflow-udeladte-zoom (1440) + 74b (1152).
 *  Phase C (date restored): /cashflow at 1440 / 1280 / 1152 — same fields again, to compare 1:1 with measure-v2p4.json.
 * Usage: npx tsx review/measure-v2p5.ts   (BASE_URL / APP_PASSWORD env override the defaults)
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3111';
const PASSWORD = process.env.APP_PASSWORD ?? 'review1234';
const RESTORE_DATE = '2026-01-01';
const SHIFT_DATE = '2026-05-01';
const OUT = path.join(process.cwd(), 'review', 'shots');
const LINES = `(el) => { const rg = document.createRange(); rg.selectNodeContents(el); const tops = new Set([...rg.getClientRects()].map((r) => Math.round(r.top))); return tops.size; }`;

const PROBE = `(() => { const lines = ${LINES}; const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim() === 'Pr. måned');
  const p = sec.querySelector('.section__head p'); const wrap = sec.querySelector('.table-wrap'); const t = wrap.querySelector('table');
  const kpi = [...document.querySelectorAll('.kpi')].find((k) => k.querySelector('.kpi__label')?.textContent.trim() === 'Åbningssaldo');
  const monos = [...p.querySelectorAll('.mono')].map((s) => ({ text: s.textContent.trim(), font: getComputedStyle(s).fontFamily, size: getComputedStyle(s).fontSize, weight: getComputedStyle(s).fontWeight, color: getComputedStyle(s).color, display: getComputedStyle(s).display }));
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); const bare = []; let n;
  while ((n = walker.nextNode())) { if (n.parentElement === p) bare.push(n.textContent); }
  const bareWithDigits = bare.filter((s) => /\\d/.test(s));
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
    kpiSub: kpi ? kpi.querySelector('.kpi__sub').textContent.trim() : null, kpiSubLines: kpi ? lines(kpi.querySelector('.kpi__sub')) : null, kpiW: kpi ? Math.round(kpi.getBoundingClientRect().width) : null }; })()`;

async function waitForServer(page: Page): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await page.goto(`${BASE}/login`, { timeout: 5000 });
      if (r && r.status() < 500) { console.log('server up after', Date.now() - t0, 'ms, status', r.status()); return; }
    } catch { /* not yet */ }
    if (Date.now() - t0 > 90_000) throw new Error('server not reachable within 90 s');
    await new Promise((res) => setTimeout(res, 2000));
  }
}

async function probeAt(page: Page, w: number): Promise<Record<string, unknown>> {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(`${BASE}/cashflow`); await page.waitForLoadState('networkidle');
  return (await page.evaluate(PROBE)) as Record<string, unknown>;
}

async function putDate(page: Page, date: string): Promise<{ status: number; body: unknown }> {
  const r = await page.request.put(`${BASE}/api/settings`, { data: { opening_balance_date: date }, headers: { 'content-type': 'application/json' } });
  let body: unknown = null; try { body = await r.json(); } catch { body = await r.text(); }
  return { status: r.status(), body };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await waitForServer(page);
  await page.fill('#password', PASSWORD); await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`);
  const m: Record<string, unknown> = {};
  const before = await (await page.request.get(`${BASE}/api/settings`)).json();
  m.settingsBefore = { opening_balance_date: before.opening_balance_date, opening_balance_ore: before.opening_balance_ore };
  console.log('settings before', m.settingsBefore);
  if (before.opening_balance_date !== RESTORE_DATE) throw new Error(`unexpected opening_balance_date ${before.opening_balance_date}; refusing to shift`);

  m.A = { 1440: await probeAt(page, 1440) };
  console.log('A monoCount', (m.A as any)[1440].monoCount);

  let shifted = false;
  try {
    const put = await putDate(page, SHIFT_DATE); m.putShift = put; shifted = put.status < 400;
    console.log('PUT shift', put.status, JSON.stringify(put.body).slice(0, 200));
    if (!shifted) throw new Error('shift PUT failed');
    const B: Record<string, unknown> = {};
    for (const w of [1440, 1280, 1152]) {
      B[String(w)] = await probeAt(page, w);
      console.log('B', w, 'monoCount', (B[String(w)] as any).monoCount, 'bareWithDigits', JSON.stringify((B[String(w)] as any).bareWithDigits));
      if (w === 1440) { await page.locator('section:has(h2:has-text("Pr. måned")) .section__head').screenshot({ path: path.join(OUT, '74-cashflow-udeladte-zoom.png') }); console.log('shot 74'); }
      if (w === 1152) { await page.locator('section:has(h2:has-text("Pr. måned")) .section__head').screenshot({ path: path.join(OUT, '74b-cashflow-udeladte-1152-zoom.png') }); console.log('shot 74b'); }
    }
    m.B = B;
  } finally {
    if (shifted) {
      const put = await putDate(page, RESTORE_DATE); m.putRestore = put;
      console.log('PUT restore', put.status, JSON.stringify(put.body).slice(0, 200));
    }
    const after = await (await page.request.get(`${BASE}/api/settings`)).json();
    m.settingsAfter = { opening_balance_date: after.opening_balance_date, opening_balance_ore: after.opening_balance_ore };
    console.log('settings after', m.settingsAfter);
  }

  const C: Record<string, unknown> = {};
  for (const w of [1440, 1280, 1152]) { C[String(w)] = await probeAt(page, w); console.log('C', w, 'monoCount', (C[String(w)] as any).monoCount); }
  m.C = C;

  // 1:1 comparison with the pass-4 dump on the geometry fields.
  const p4Path = path.join(process.cwd(), 'review', 'measure-v2p4.json');
  if (fs.existsSync(p4Path)) {
    const p4 = JSON.parse(fs.readFileSync(p4Path, 'utf8'));
    const FIELDS = ['heads', 'cellSubs', 'wrap', 'table', 'hiddenPx', 'rowHeights', 'colWidths', 'introLines', 'introW', 'introH', 'introMaxW', 'kpiSub', 'kpiSubLines', 'kpiW', 'numCells', 'numNotRight', 'numFontsNotMono', 'otherTables', 'pageHScroll', 'rows', 'foot', 'intro', 'monoCount', 'pFont', 'pSize', 'pLineHeight'];
    const diff: Record<string, Record<string, { p4: unknown; p5C: unknown; p5B: unknown }>> = {};
    for (const w of ['1440', '1280', '1152']) {
      diff[w] = {};
      for (const f of FIELDS) {
        const a = JSON.stringify(p4[w]?.[f]); const c = JSON.stringify((C[w] as any)[f]); const b = JSON.stringify((m.B as any)?.[w]?.[f]);
        if (a !== c || a !== b) diff[w][f] = { p4: p4[w]?.[f], p5C: (C[w] as any)[f], p5B: (m.B as any)?.[w]?.[f] };
      }
    }
    m.diffVsP4 = diff;
    console.log('diff vs pass 4 (fields differing in C=restored or B=shifted):', JSON.stringify(diff, null, 1));
  }

  fs.writeFileSync(path.join(OUT, '..', 'measure-v2p5.json'), JSON.stringify(m, null, 2));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
