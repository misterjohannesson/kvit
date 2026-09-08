/**
 * Spec v2 — pass 3 probe (read-only; creates one temp draft and deletes it).
 *  A. /balance at 1440 / 1280 / 1152: every `.totals__row dd` → line-box count (Range.getClientRects),
 *     computed white-space, dt/dd widths, hint line count (finding 15). Shot 58b (Aktiver totals, 1152).
 *  B. /fakturaer/<1001> at 1440 / 1280 / 1152: line table vs wrap, Beskrivelse/Konto cell class,
 *     white-space and line count (finding 13). Shot 62b (line table, 1152).
 *  C. Editor head row text at 1440 / 1152 and the first head cell's line count (finding 14).
 *  D. /cashflow at 1440 / 1280 / 1152: head texts, `.cell-sub` count, intro sentence text + lines,
 *     Åbningssaldo KPI sub (finding 3 + the start-of-day copy). Shots 71 / 71b / 71c.
 *  E. /indstillinger: opening-balance hint text + lines at 1440 / 1152. Shot 72 (form, 1152).
 *  F. Credit notes: which have an unpaid original (`originalPaidDate === null`) — foot children on that page.
 * Usage: BASE_URL=http://127.0.0.1:3109 APP_PASSWORD=review1234 npx tsx review/measure-v2p3.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3109';
const PASSWORD = process.env.APP_PASSWORD ?? 'review1234';
const OUT = path.join(process.cwd(), 'review', 'shots');
const LINES = `(el) => { const rg = document.createRange(); rg.selectNodeContents(el); const tops = new Set([...rg.getClientRects()].map((r) => Math.round(r.top))); return tops.size; }`;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.fill('#password', PASSWORD); await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`);
  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as { id: number; invoiceNumber: number | null; status: string; isCreditNote: boolean; paidDate: string | null }[];
  const customers = (await (await ctx.request.get(`${BASE}/api/customers`)).json()) as { id: number }[];
  const issued = invoices.find((i) => i.invoiceNumber === 1001) ?? invoices.find((i) => i.status === 'issued' && !i.isCreditNote);
  const m: Record<string, unknown> = {};
  const at = async (w: number, url: string) => { await page.setViewportSize({ width: w, height: 900 }); await page.goto(`${BASE}${url}`); await page.waitForLoadState('networkidle'); };

  // A. Balance dd line boxes.
  const bal: Record<string, unknown> = {};
  for (const w of [1440, 1280, 1152]) {
    await at(w, '/balance');
    bal[String(w)] = await page.evaluate(`(() => { const lines = ${LINES};
      return [...document.querySelectorAll('.totals__row')].map((row) => { const dt = row.querySelector('dt'); const dd = row.querySelector('dd'); const hint = dt.querySelector('.hint');
        return { label: dt.firstChild.textContent.trim().slice(0, 24), dd: dd.textContent.trim(), ddLines: lines(dd), ddWs: getComputedStyle(dd).whiteSpace, ddW: Math.round(dd.getBoundingClientRect().width), dtW: Math.round(dt.getBoundingClientRect().width), rowW: Math.round(row.getBoundingClientRect().width), hintLines: hint ? lines(hint) : 0 }; }); })()`);
    if (w === 1152) { await page.locator('.panel:has(.totals)').first().screenshot({ path: path.join(OUT, '58b-balance-aktiver-1152-zoom.png') }); console.log('shot 58b'); }
  }
  m.balanceDd = bal;

  // B. Issued invoice line table.
  const iss: Record<string, unknown> = {};
  if (issued) for (const w of [1440, 1280, 1152]) {
    await at(w, `/fakturaer/${issued.id}`);
    iss[String(w)] = await page.evaluate(`(() => { const lines = ${LINES}; const wrap = document.querySelector('.table-wrap'); const t = wrap.querySelector('table');
      return { wrap: wrap.clientWidth, table: Math.round(t.getBoundingClientRect().width), hiddenPx: wrap.scrollWidth - wrap.clientWidth, cols: [...t.tHead.rows[0].cells].map((c) => c.textContent.trim()),
        rows: [...t.tBodies[0].rows].map((r) => [...r.cells].map((c) => ({ cls: c.className, ws: getComputedStyle(c).whiteSpace, lines: lines(c), w: Math.round(c.getBoundingClientRect().width), text: c.textContent.trim().slice(0, 30) })).filter((c, i) => i === 0 || c.cls.includes('wrap'))),
        rowHeights: [...t.tBodies[0].rows].map((r) => Math.round(r.getBoundingClientRect().height)) }; })()`);
    if (w === 1152) { await page.locator('.table-wrap').first().screenshot({ path: path.join(OUT, '62b-faktura-udstedt-linjer-1152-zoom.png') }); console.log('shot 62b'); }
  }
  m.issuedLines = iss;

  // C. Editor head.
  const draftRes = await ctx.request.post(`${BASE}/api/invoices`, { data: { customerId: customers[0].id } });
  const draft = (await draftRes.json()) as { id: number };
  await ctx.request.put(`${BASE}/api/invoices/${draft.id}`, { data: { customerId: customers[0].id, issueDate: '2026-09-07', dueDate: '2026-09-21', paymentReference: 'Reg. 1234 Konto 1234567890',
    lines: [{ description: 'Konceptudvikling, uge 36', quantity: 12, unit: 'time', unitPriceOre: 95000 }, { description: 'Transport, Kbh–Aarhus', quantity: 1, unit: 'stk.', unitPriceOre: 120000 }] } });
  const ed: Record<string, unknown> = {};
  for (const w of [1440, 1152]) {
    await at(w, `/fakturaer/${draft.id}`);
    ed[String(w)] = await page.evaluate(`(() => { const lines = ${LINES}; const t = document.querySelector('table.lines'); const th = [...t.tHead.rows[0].cells];
      const first = t.tBodies[0].rows[0].cells[0]; const sel = first.querySelector('select'); const inp = first.querySelector('input');
      return { heads: th.map((c) => c.textContent.trim()), firstHeadLines: lines(th[0]), firstHeadW: Math.round(th[0].getBoundingClientRect().width), headH: Math.round(t.tHead.rows[0].getBoundingClientRect().height),
        selectAria: sel ? sel.getAttribute('aria-label') : null, selectValueText: sel ? sel.options[sel.selectedIndex].textContent.trim() : null, selectOptions: sel ? [...sel.options].map((o) => o.textContent.trim()) : null, inputAria: inp ? inp.getAttribute('aria-label') : null, inputPlaceholder: inp ? inp.placeholder : null }; })()`);
  }
  m.editorHead = ed;
  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);

  // D. Cashflow.
  const cf: Record<string, unknown> = {};
  for (const w of [1440, 1280, 1152]) {
    await at(w, '/cashflow');
    cf[String(w)] = await page.evaluate(`(() => { const lines = ${LINES}; const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim() === 'Pr. måned');
      const p = sec.querySelector('.section__head p'); const wrap = sec.querySelector('.table-wrap'); const t = wrap.querySelector('table');
      const kpi = [...document.querySelectorAll('.kpi')].find((k) => k.querySelector('.kpi__label')?.textContent.trim() === 'Åbningssaldo');
      return { heads: [...t.tHead.rows[0].cells].map((c) => c.textContent.trim()), cellSubs: t.querySelectorAll('.cell-sub').length, wrap: wrap.clientWidth, hiddenPx: wrap.scrollWidth - wrap.clientWidth,
        rowHeights: [...t.tBodies[0].rows].map((r) => Math.round(r.getBoundingClientRect().height)), rows: [...t.tBodies[0].rows].map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' | ')),
        colWidths: [...t.tBodies[0].rows[0].cells].map((c) => Math.round(c.getBoundingClientRect().width)),
        intro: p.textContent.trim(), introLines: lines(p), introW: Math.round(p.getBoundingClientRect().width), introMaxW: getComputedStyle(p).maxWidth, introFont: getComputedStyle(p).fontSize + ' / ' + getComputedStyle(p).lineHeight,
        kpiSub: kpi ? kpi.querySelector('.kpi__sub').textContent.trim() : null, kpiSubLines: kpi ? lines(kpi.querySelector('.kpi__sub')) : null, kpiW: kpi ? Math.round(kpi.getBoundingClientRect().width) : null }; })()`);
    if (w === 1440) { await page.locator('section:has(h2:has-text("Pr. måned")) .section__head').screenshot({ path: path.join(OUT, '71-cashflow-intro-zoom.png') }); console.log('shot 71'); }
    if (w === 1152) { await page.locator('section:has(h2:has-text("Pr. måned")) .section__head').screenshot({ path: path.join(OUT, '71b-cashflow-intro-1152-zoom.png') }); console.log('shot 71b');
      await page.locator('.kpis').first().screenshot({ path: path.join(OUT, '71c-cashflow-kpis-1152-zoom.png') }); console.log('shot 71c'); }
  }
  m.cashflow = cf;

  // E. Indstillinger hint.
  const ind: Record<string, unknown> = {};
  for (const w of [1440, 1152]) {
    await at(w, '/indstillinger');
    ind[String(w)] = await page.evaluate(`(() => { const lines = ${LINES}; const f = document.querySelector('#opening_balance').closest('.field'); const h = f.querySelector('.hint, .error');
      return { hint: h.textContent.trim(), hintLines: lines(h), fieldW: Math.round(f.getBoundingClientRect().width), fieldClass: f.className, inputW: Math.round(document.querySelector('#opening_balance').getBoundingClientRect().width),
        siblingHint: f.nextElementSibling ? (f.nextElementSibling.querySelector('.hint')?.textContent.trim() ?? null) : null, siblingHintLines: f.nextElementSibling && f.nextElementSibling.querySelector('.hint') ? lines(f.nextElementSibling.querySelector('.hint')) : null }; })()`);
    if (w === 1152) { await page.locator('form:has(#opening_balance)').screenshot({ path: path.join(OUT, '72-indstillinger-aabningssaldo-1152-zoom.png') }); console.log('shot 72'); }
  }
  m.indstillinger = ind;

  // F. Credit notes and their originals.
  const cns = invoices.filter((i) => i.isCreditNote && i.status === 'issued');
  const details: { id: number; nr: number; paidDate: string | null; originalPaidDate: string | null; credits: number | null }[] = [];
  for (const cn of cns) {
    const d = (await (await ctx.request.get(`${BASE}/api/invoices/${cn.id}`)).json()) as { id: number; invoiceNumber: number; paidDate: string | null; originalPaidDate: string | null; creditsInvoiceId: number | null };
    details.push({ id: d.id, nr: d.invoiceNumber, paidDate: d.paidDate, originalPaidDate: d.originalPaidDate, credits: d.creditsInvoiceId });
  }
  m.creditNotes = details;
  const unpaidOrig = details.find((d) => d.originalPaidDate === null);
  if (unpaidOrig) {
    await at(1440, `/fakturaer/${unpaidOrig.id}`);
    m.creditNoteUnpaidOriginal = await page.evaluate(`(() => ({ foot: [...(document.querySelector('.panel__foot')?.children ?? [])].map((c) => c.className + ' | ' + c.textContent.trim()), forms: document.querySelectorAll('.panel__foot form').length, primaries: document.querySelectorAll('.btn--primary').length, facts: [...document.querySelectorAll('.facts dt, .facts dd')].map((d) => d.textContent.trim()) }))()`);
    await page.locator('.panel:has(.panel__foot)').first().screenshot({ path: path.join(OUT, '73-kreditnota-ubetalt-original-zoom.png') }); console.log('shot 73');
  } else m.creditNoteUnpaidOriginal = 'none on instance';

  fs.writeFileSync(path.join(OUT, '..', 'measure-v2p3.json'), JSON.stringify(m, null, 2));
  console.log(JSON.stringify(m, null, 2));
  await browser.close();
})();
