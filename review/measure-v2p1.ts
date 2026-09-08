/**
 * Read-only alignment probe (spec v2, pass 1 + pass 2): for every table.data on the
 * listed pages, report each .num th/td whose computed text-align is not `right`, and
 * the horizontal distance between the head text's right edge and the first body
 * cell's text right edge (heads should sit over the units digit).
 *
 * Usage: BASE_URL=http://127.0.0.1:3108 APP_PASSWORD=... npx tsx review/measure-v2p1.ts
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3108';
const PASSWORD = process.env.APP_PASSWORD ?? 'review1234';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.fill('#password', PASSWORD); await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`);
  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as { id: number; invoiceNumber: number | null; status: string }[];
  const issued = invoices.find((i) => i.invoiceNumber === 1001) ?? invoices.find((i) => i.status === 'issued');
  const draft = invoices.find((i) => i.status === 'draft');
  const pages = ['/', '/fakturaer', '/udgifter', '/kunder', '/moms?year=2026&quarter=3', '/indstillinger', '/eksport', '/resultat?year=2026', '/cashflow', '/balance'];
  if (issued) pages.push(`/fakturaer/${issued.id}`);
  if (draft) pages.push(`/fakturaer/${draft.id}`);
  let numCells = 0, notRight = 0;
  for (const url of pages) {
    await page.goto(`${BASE}${url}`); await page.waitForLoadState('networkidle');
    const r = await page.evaluate(`(() => [...document.querySelectorAll('table.data')].map((t) => {
      const textRight = (c) => { const rg = document.createRange(); rg.selectNodeContents(c); const rr = rg.getBoundingClientRect(); return rr.width ? rr.right : null; };
      const ths = t.tHead ? [...t.tHead.rows[0].cells] : [];
      const body = t.tBodies[0] && t.tBodies[0].rows[0] ? [...t.tBodies[0].rows[0].cells] : [];
      const cells = [...t.querySelectorAll('th.num, td.num')];
      const bad = cells.filter((c) => getComputedStyle(c).textAlign !== 'right').map((c) => c.tagName + ':' + c.textContent.trim().slice(0, 20));
      const heads = ths.map((c, i) => ({ text: c.textContent.trim().slice(0, 18), num: c.classList.contains('num'), align: getComputedStyle(c).textAlign,
        headVsBodyRight: (c.classList.contains('num') && body[i]) ? Math.round((textRight(c) ?? 0) - (textRight(body[i]) ?? 0)) : null }));
      return { cols: ths.length, numCells: cells.length, notRight: bad, heads };
    }))()`) as { cols: number; numCells: number; notRight: string[]; heads: unknown[] }[];
    for (const t of r) { numCells += t.numCells; notRight += t.notRight.length; }
    console.log(url, JSON.stringify(r));
  }
  console.log(`SUMMARY .num cells: ${numCells}, not right-aligned: ${notRight}`);
  await browser.close();
})();
