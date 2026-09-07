/**
 * Pass 7 probe: verification of F1 and F2 (commit d897fab) plus the new
 * line-error markup in the invoice editor.
 *  - Momsindberetning at 1440 / 1280 / 1279 / 1152: `.layout-6-6--tables`
 *    grid columns, side-by-side vs stacked, both tables vs their `.table-wrap`
 *    (hidden px, every `Moms` cell inside the wrap), page-level h-scroll (F1).
 *  - Issued-invoice detail Kunde cell at 1440 / 1280 / 1152: the `.cell-sub`
 *    text must read "… København Ø · CVR 38 41 22 07" (F2), CVR on one line.
 *  - Editor: save a line with quantity `abc` through the UI (`Gem kladde`,
 *    use:enhance) and read the `Fakturalinjer` error paragraph, the fieldset
 *    class list, and the computed border colour of every line input against the
 *    normal input border and the error border.
 *  - example.html from disk at 1440 / 1279: the `.layout-6-6--tables` rule
 *    resolves (the reference has no 6/6 demo, so a probe element is used).
 * Writes shots 45 (Moms 1152, refreshed), 47 (Moms 1280), 48 (Moms 1279),
 * 49 (editor line error) and 49b (zoom of the Fakturalinjer fieldset).
 * Creates one draft and deletes it again.
 * Usage: BASE_URL=http://127.0.0.1:3108 APP_PASSWORD=review1234 npx tsx review/measure-p7.ts
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3108';
const PASSWORD = process.env.APP_PASSWORD ?? 'review1234';
const OUT = path.join(process.cwd(), 'review', 'shots');

const MOMS = `(() => {
  const g = document.querySelector('.layout-6-6'); if (!g) return 'no .layout-6-6';
  const kids = Array.from(g.children);
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), w: Math.round(b.width) }; };
  const first = kids[0].getBoundingClientRect(), second = kids[1].getBoundingClientRect();
  const tables = Array.from(g.querySelectorAll('table.data')).map((t) => {
    const w = t.closest('.table-wrap'); const wr = Math.round(w.getBoundingClientRect().right);
    const num = Array.from(t.querySelectorAll('tbody td.num, tfoot td.num'));
    return { title: t.closest('.panel').querySelector('.panel__title').textContent.trim(), tableW: Math.round(t.getBoundingClientRect().width), wrapClientW: w.clientWidth, wrapScrollW: w.scrollWidth,
      hiddenPx: Math.max(0, w.scrollWidth - w.clientWidth), wrapRight: wr,
      cols: Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent.trim() + '=' + Math.round(th.getBoundingClientRect().width)),
      numCellsOutside: num.filter((c) => Math.round(c.getBoundingClientRect().right) > wr).map((c) => c.textContent.trim()),
      numCells: num.length,
      proseLines: Array.from(t.querySelectorAll('tbody td.wrap')).map((c) => { const lh = parseFloat(getComputedStyle(c).lineHeight); const py = parseFloat(getComputedStyle(c).paddingTop) + parseFloat(getComputedStyle(c).paddingBottom); const sub = c.querySelector('.cell-sub'); return Math.round((c.getBoundingClientRect().height - py - (sub ? sub.getBoundingClientRect().height : 0)) / lh); }) };
  });
  return { vw: innerWidth, classes: g.className, gridCols: getComputedStyle(g).gridTemplateColumns,
    sideBySide: second.left >= first.right - 1 && Math.abs(second.top - first.top) < 2, stacked: second.top >= first.bottom - 1,
    panels: kids.map(r), tables, docHScroll: document.documentElement.scrollWidth > innerWidth };
})()`;

const CVR = `(() => {
  const cvr = document.querySelector('.facts .cell-sub .mono'); if (!cvr) return 'no CVR span';
  const sub = cvr.parentElement; const text = sub.textContent;
  return { vw: innerWidth, text, spacedSeparator: / Ø · CVR 38 41 22 07$/.test(text), lineBoxes: cvr.getClientRects().length, ws: getComputedStyle(cvr).whiteSpace,
    subW: Math.round(sub.getBoundingClientRect().width), subH: Math.round(sub.getBoundingClientRect().height) };
})()`;

const LINE_ERR = `(() => {
  const fs = Array.from(document.querySelectorAll('fieldset')).find((f) => f.querySelector('legend') && f.querySelector('legend').textContent.trim() === 'Fakturalinjer');
  const p = fs.querySelector('p.error.formerror');
  const probe = document.createElement('input'); probe.className = 'input'; document.body.appendChild(probe);
  const normal = getComputedStyle(probe).borderColor; probe.remove();
  const wrap = document.createElement('div'); wrap.className = 'field field--error'; const pe = document.createElement('input'); pe.className = 'input'; wrap.appendChild(pe); document.body.appendChild(wrap);
  const errBorder = getComputedStyle(pe).borderColor; wrap.remove();
  const inputs = Array.from(fs.querySelectorAll('input.input')).map((i) => ({ label: i.getAttribute('aria-label'), border: getComputedStyle(i).borderColor }));
  const otherErrors = Array.from(document.querySelectorAll('.field--error')).map((e) => e.className);
  const legend = fs.querySelector('legend'); const table = fs.querySelector('table');
  return { fieldsetClass: fs.className, errorText: p ? p.textContent : null,
    errorStyle: p ? { color: getComputedStyle(p).color, fontSize: getComputedStyle(p).fontSize, marginBottom: getComputedStyle(p).marginBottom } : null,
    order: p ? { legendBottom: Math.round(legend.getBoundingClientRect().bottom), errorTop: Math.round(p.getBoundingClientRect().top), errorBottom: Math.round(p.getBoundingClientRect().bottom), tableTop: Math.round(table.getBoundingClientRect().top) } : null,
    normalBorder: normal, errorBorder: errBorder, inputs, outlinedInputs: inputs.filter((i) => i.border !== normal).length, fieldErrorElements: otherErrors,
    negativeToken: getComputedStyle(document.documentElement).getPropertyValue('--text-negative').trim(),
    panelError: Array.from(document.querySelectorAll('.panel__body > p.formerror')).map((e) => e.textContent) };
})()`;

const EXAMPLE = `(() => {
  const probe = (cls) => { const d = document.createElement('div'); d.className = cls; d.appendChild(document.createElement('div')); d.appendChild(document.createElement('div')); document.body.appendChild(d); const v = getComputedStyle(d).gridTemplateColumns; d.remove(); return v; };
  return { vw: innerWidth, plain66: probe('layout-6-6'), tables66: probe('layout-6-6 layout-6-6--tables') };
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
  const customers = (await (await ctx.request.get(`${BASE}/api/customers`)).json()) as { id: number }[];
  const issued = invoices.find((i) => i.invoiceNumber === 1001)!;

  // F1 + F2.
  for (const w of [1440, 1280, 1279, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/moms?year=2026&quarter=3`);
    await page.waitForSelector('.layout-6-6 table.data');
    console.log(`== F1 moms @${w}`, JSON.stringify(await page.evaluate(MOMS)));
    if (w === 1280) await page.screenshot({ path: path.join(OUT, '47-moms-1280.png'), fullPage: true });
    if (w === 1279) await page.screenshot({ path: path.join(OUT, '48-moms-1279.png'), fullPage: true });
    if (w === 1152) await page.screenshot({ path: path.join(OUT, '45-moms-1152.png'), fullPage: true });
    if (w !== 1279) {
      await page.goto(`${BASE}/fakturaer/${issued.id}`);
      await page.waitForSelector('.facts');
      console.log(`== F2 detail CVR @${w}`, JSON.stringify(await page.evaluate(CVR)));
    }
  }

  // Line error: quantity `abc` saved through the UI.
  await page.setViewportSize({ width: 1440, height: 900 });
  const draft = (await (await ctx.request.post(`${BASE}/api/invoices`, { data: { customerId: customers[0].id } })).json()) as { id: number };
  await page.goto(`${BASE}/fakturaer/${draft.id}`);
  await page.waitForSelector('table.lines');
  await page.fill('input[aria-label="Beskrivelse, linje 1"]', 'Rådgivning');
  await page.fill('input[aria-label="Antal, linje 1"]', 'abc');
  await page.fill('input[aria-label="Pris, linje 1"]', '1.000,00');
  await page.click('button.btn:has-text("Gem kladde")');
  await page.waitForSelector('fieldset p.error.formerror', { timeout: 10000 }).catch(() => console.log('!! no fieldset line error appeared'));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  console.log('== line error @1440', JSON.stringify(await page.evaluate(LINE_ERR)));
  await page.screenshot({ path: path.join(OUT, '49-faktura-kladde-linjefejl.png'), fullPage: true });
  const fsBox = await page.locator('fieldset:has(legend:text-is("Fakturalinjer"))').boundingBox();
  if (fsBox) await page.screenshot({ path: path.join(OUT, '49b-faktura-kladde-linjefejl-zoom.png'), clip: { x: fsBox.x - 8, y: fsBox.y - 8, width: fsBox.width + 16, height: Math.min(fsBox.height + 16, 260) } });
  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);

  // Reference from disk.
  const ex = pathToFileURL(path.join(process.cwd(), 'example.html')).href;
  for (const w of [1440, 1279]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(ex);
    await page.waitForSelector('.layout-8-4');
    console.log(`== example.html @${w}`, JSON.stringify(await page.evaluate(EXAMPLE)));
  }
  console.log('shots 45, 47, 48, 49, 49b written');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
