/**
 * Additional review states not covered by shots.ts: login error, filtered and
 * empty invoice lists, 404 page, expense form per-field validation errors,
 * credit-note confirm step (.confirmbox), paid-invoice detail, row hover,
 * Kompakt density on Fakturaer/Udgifter, editor date-field error, empty
 * customer detail, toolbar zoom and the 1152px minimum width.
 *
 * Usage: BASE_URL=http://127.0.0.1:3102 APP_PASSWORD=... npx tsx review/shots-extra.ts
 * Output: review/shots/2x-*.png and 3x-*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3101';
const PASSWORD = process.env.APP_PASSWORD ?? 'test1234';
const OUT = path.join(process.cwd(), 'review', 'shots');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const log = (n: string) => console.log('shot', n);

  // Login: wrong password -> field error state.
  await page.goto(`${BASE}/login`);
  await page.fill('#password', 'forkert');
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
  await shot('20-login-fejl'); log('20');

  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);

  const invoices = (await (await ctx.request.get(`${BASE}/api/invoices`)).json()) as {
    id: number; invoiceNumber: number | null; status: string; isCreditNote: boolean; paidDate: string | null;
  }[];
  const customers = (await (await ctx.request.get(`${BASE}/api/customers`)).json()) as { id: number }[];

  // Filtered lists.
  for (const [name, status] of [
    ['21-fakturaer-forfaldne', 'forfaldne'],
    ['22-fakturaer-kladder', 'kladder'],
    ['23-fakturaer-krediterede', 'krediterede']
  ] as const) {
    await page.goto(`${BASE}/fakturaer?status=${status}`);
    await page.waitForLoadState('networkidle');
    await shot(name); log(name);
  }

  // Row hover on the invoice list.
  await page.goto(`${BASE}/fakturaer`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('table.data tbody tr').nth(1);
  await row.hover();
  await page.screenshot({ path: path.join(OUT, '24-fakturaer-hover.png'), fullPage: false }); log('24');

  // 404 error page.
  await page.goto(`${BASE}/fakturaer/999999`);
  await page.waitForLoadState('networkidle');
  await shot('25-fejlside-404'); log('25');

  // Expense form: invalid amount + invalid date -> per-field error states.
  await page.goto(`${BASE}/udgifter`);
  await page.fill('#date', '31.02.2026');
  await page.fill('#supplier', 'Test ApS');
  // spec v2: the free-text Kategori became a Konto <select> (defaults to the first cost account)
  await page.fill('#description', 'Valideringstest');
  await page.fill('#amountExVat', 'abc');
  await page.fill('#vat', '0,00');
  await page.click('form[action="?/create"] button[type=submit]');
  await page.waitForLoadState('networkidle');
  await shot('26-udgift-valideringsfejl'); log('26');

  // Issued, uncredited, unpaid invoice: open the credit-note confirm step.
  const openInv = invoices.find((i) => i.status === 'issued' && !i.isCreditNote && !i.paidDate);
  if (openInv) {
    await page.goto(`${BASE}/fakturaer/${openInv.id}`);
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Opret kreditnota")');
    await page.waitForSelector('.confirmbox');
    await shot('27-faktura-kreditnota-bekraeft'); log('27');
  }

  // Paid invoice detail.
  const paidInv = invoices.find((i) => i.status === 'issued' && !i.isCreditNote && i.paidDate);
  if (paidInv) {
    await page.goto(`${BASE}/fakturaer/${paidInv.id}`);
    await page.waitForLoadState('networkidle');
    await shot('28-faktura-betalt'); log('28');
  }

  // A fresh draft for the editor states (deleted again afterwards).
  const draftRes = await ctx.request.post(`${BASE}/api/invoices`, { data: { customerId: customers[0].id } });
  const draft = (await draftRes.json()) as { id: number };

  // Kompakt density on Fakturaer and Udgifter (cookie via the segment form), then back to Normal.
  await page.goto(`${BASE}/fakturaer`);
  await page.waitForLoadState('networkidle');
  await page.locator('.toolbar').screenshot({ path: path.join(OUT, '33-fakturaer-toolbar-zoom.png') }); log('33');
  await page.click('form[action="/density"] button[value=dense]');
  await page.waitForLoadState('networkidle');
  await shot('31-fakturaer-kompakt'); log('31');
  await page.goto(`${BASE}/udgifter`);
  await page.waitForLoadState('networkidle');
  await shot('32-udgifter-kompakt'); log('32');
  await page.click('form[action="/density"] button[value=normal]');
  await page.waitForLoadState('networkidle');

  // Editor: valid line but invalid date on Gem kladde -> field error in the editor.
  await page.goto(`${BASE}/fakturaer/${draft.id}`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[aria-label="Beskrivelse, linje 1"]', 'Rådgivning');
  await page.fill('input[aria-label="Pris, linje 1"]', '1.000,00');
  await page.fill('#issueDate', 'abc');
  await page.click('button.btn:has-text("Gem kladde")');
  await page.waitForSelector('.field--error', { timeout: 10000 }).catch(() => {});
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300); // let the 80 ms button transitions settle
  await shot('34-faktura-kladde-datofejl'); log('34');

  // Expense detail: invalid amount on save -> field error in the stacked form.
  const expenses = (await (await ctx.request.get(`${BASE}/api/expenses`)).json()) as { id: number }[];
  if (expenses[0]) {
    await page.goto(`${BASE}/udgifter/${expenses[0].id}`);
    await page.waitForLoadState('networkidle');
    await page.fill('form[action="?/save"] #amountExVat', 'abc');
    await page.click('form[action="?/save"] button[type=submit]');
    await page.waitForLoadState('networkidle');
    await shot('36-udgift-bilag-fejl'); log('36');
  }

  // Customer without invoices -> empty state with its one secondary button.
  const custRes = await ctx.request.post(`${BASE}/api/customers`, {
    data: { name: 'Review Tom ApS', address: 'Testvej 1', zip: '8000', city: 'Aarhus C', country: 'DK' }
  });
  const cust = custRes.ok() ? ((await custRes.json()) as { id: number }) : null;
  if (cust) {
    await page.goto(`${BASE}/kunder/${cust.id}`);
    await page.waitForLoadState('networkidle');
    await shot('35-kunde-tom'); log('35');
    await ctx.request.delete(`${BASE}/api/customers/${cust.id}`);
  }

  // Minimum supported width (style.md §2: usable from 1152px).
  await page.setViewportSize({ width: 1152, height: 900 });
  await page.goto(`${BASE}/fakturaer`);
  await page.waitForLoadState('networkidle');
  await shot('29-fakturaer-1152'); log('29');
  await page.goto(`${BASE}/fakturaer/${draft.id}`);
  await page.waitForLoadState('networkidle');
  await shot('30-faktura-kladde-1152'); log('30');

  // ------------------------------------------------------------------------
  // Spec v2 — pass 1: Resultat / Cashflow / Balance, kontoplan, Konto selects.
  // Nothing below books data: the Balance reconcile stops at the preview step
  // and the Cashflow movement form is submitted with invalid values only.
  // ------------------------------------------------------------------------
  const measure: Record<string, unknown> = {};
  await page.setViewportSize({ width: 1440, height: 900 });

  // Give the draft two real lines so the Konto select shows alongside content.
  await ctx.request.put(`${BASE}/api/invoices/${draft.id}`, {
    data: {
      customerId: customers[0].id,
      issueDate: '2026-09-07',
      dueDate: '2026-09-21',
      paymentReference: 'Reg. 1234 Konto 1234567890',
      lines: [
        { description: 'Konceptudvikling, uge 36', quantity: 12, unit: 'time', unitPriceOre: 95000 },
        { description: 'Transport, Kbh–Aarhus', quantity: 1, unit: 'stk.', unitPriceOre: 120000 }
      ]
    }
  });

  // 50: Balance reconcile — enter the bank balance, compare, confirm box (not booked).
  await page.goto(`${BASE}/balance`);
  await page.waitForLoadState('networkidle');
  await page.fill('#actual', '100.000,00');
  await page.click('form[action="?/reconcile"] button[type=submit]');
  await page.waitForSelector('.confirmbox', { timeout: 10000 });
  await shot('50-balance-afstemning-bekraeft'); log('50');
  await page.locator('.panel:has(.confirmbox)').screenshot({ path: path.join(OUT, '50b-balance-afstemning-bekraeft-zoom.png') }); log('50b');
  measure.balancePrimaries = await page.locator('.btn--primary').count();

  // 51: Balance reconcile with an unparsable amount -> error state.
  await page.goto(`${BASE}/balance`);
  await page.waitForLoadState('networkidle');
  await page.fill('#actual', 'abc');
  await page.click('form[action="?/reconcile"] button[type=submit]');
  await page.waitForLoadState('networkidle');
  await page.locator('section:has(#actual) .panel, .panel:has(#actual)').first().screenshot({ path: path.join(OUT, '51-balance-afstemning-fejl.png') }); log('51');
  measure.balanceError = await page.evaluate(() => {
    const input = document.querySelector('#actual') as HTMLElement | null;
    const err = document.querySelector('.formerror, .error');
    return {
      fieldErrorWrappers: document.querySelectorAll('.field--error').length,
      inputBorder: input ? getComputedStyle(input).borderColor : null,
      probeBorder: (() => { const p = document.createElement('input'); p.className = 'input'; document.body.appendChild(p); const c = getComputedStyle(p).borderColor; p.remove(); return c; })(),
      errorText: err?.textContent?.trim() ?? null
    };
  });

  // 52: Cashflow movement form with an invalid date and amount -> field errors.
  await page.goto(`${BASE}/cashflow`);
  await page.waitForLoadState('networkidle');
  await page.fill('#mv-date', '31.02.2026');
  await page.fill('#mv-amount', 'abc');
  await page.fill('#mv-desc', 'Valideringstest');
  await page.click('form[action="?/create"] button[type=submit]');
  await page.waitForLoadState('networkidle');
  await shot('52-cashflow-bevaegelse-fejl'); log('52');
  await page.locator('.panel:has(#mv-amount)').screenshot({ path: path.join(OUT, '52b-cashflow-bevaegelse-fejl-zoom.png') }); log('52b');
  // (plain-string body: tsx/esbuild injects a `__name` helper for named inner arrows, which does not exist in the page)
  measure.cashflowForm = await page.evaluate(`(() => {
    const primary = document.querySelector('.btn--primary');
    const inputs = ['#mv-date', '#mv-amount', '#mv-kind', '#mv-desc'].map((s) => ({ s, w: document.querySelector(s)?.getBoundingClientRect().width ?? null }));
    // spec v2 pass 2: the movement form is its own panel ("Ny bankbevægelse") with a .panel__foot; the movements table is the next section.
    const formPanel = document.querySelector('form.panel[action="?/create"]');
    const foot = formPanel ? formPanel.querySelector('.panel__foot') : null;
    const movementsSection = formPanel && formPanel.closest('section') ? formPanel.closest('section').nextElementSibling : null;
    const wrap = movementsSection ? movementsSection.querySelector('.table-wrap') : null;
    const table = wrap ? wrap.querySelector('table.data') : null;
    return {
      fieldErrors: [...document.querySelectorAll('.field--error .error')].map((e) => e.textContent?.trim()),
      primaryText: primary?.textContent?.trim(), primaryHeight: primary?.getBoundingClientRect().height ?? null,
      inputs,
      formIsPanel: !!formPanel, formParentClass: formPanel?.parentElement?.className ?? null,
      panelTitle: formPanel?.querySelector('.panel__title')?.textContent?.trim() ?? null,
      footRule: foot ? getComputedStyle(foot).borderTopWidth : null, footPaddingTop: foot ? getComputedStyle(foot).paddingTop : null,
      primaryInFoot: !!(primary && foot && foot.contains(primary)),
      formPanelBottom: formPanel?.getBoundingClientRect().bottom ?? null, movementsPanelTop: movementsSection?.getBoundingClientRect().top ?? null,
      movementsTable: table ? { cols: table.tHead.rows[0].cells.length, wrap: wrap.clientWidth, hiddenPx: wrap.scrollWidth - wrap.clientWidth, descWrap: getComputedStyle(table.tBodies[0].rows[0]?.cells[1] ?? table).whiteSpace } : null,
      primaries: document.querySelectorAll('.btn--primary').length
    };
  })()`);

  // 53: Indstillinger — kontoplan panel and its add-account footer.
  await page.goto(`${BASE}/indstillinger`);
  await page.waitForLoadState('networkidle');
  const kontoplan = page.locator('section:has(h2:has-text("Kontoplan")) .panel');
  await kontoplan.screenshot({ path: path.join(OUT, '53-indstillinger-kontoplan.png') }); log('53');
  measure.kontoplan = await page.evaluate(() => {
    const table = document.querySelector('section:has(h2) table.data:has(.input--cell)') as HTMLTableElement | null;
    const rows = table ? [...table.tBodies[0].rows] : [];
    const th = table ? [...table.tHead!.rows[0].cells] : [];
    const numTh = th.find((c) => c.classList.contains('num'));
    const numTd = rows[0]?.cells[3] ?? null;
    const foot = document.querySelector('form[action="?/addAccount"]') as HTMLElement | null;
    const footInputs = foot ? [...foot.querySelectorAll('input, select')].map((el) => {
      const e = el as HTMLElement; const id = e.id; const lab = id ? document.querySelector(`label[for="${id}"]`) : null;
      return { name: (e as HTMLInputElement).name, visibleLabel: lab ? !lab.hasAttribute('hidden') : false, ariaLabel: e.getAttribute('aria-label'), placeholder: (e as HTMLInputElement).placeholder, w: e.getBoundingClientRect().width };
    }) : [];
    return {
      rowHeights: rows.map((r) => r.getBoundingClientRect().height),
      rowHeightToken: getComputedStyle(document.documentElement).getPropertyValue('--table-row-height').trim(),
      numThRight: numTh?.getBoundingClientRect().right ?? null, numTdRight: numTd?.getBoundingClientRect().right ?? null,
      numTdAlign: numTd ? getComputedStyle(numTd).textAlign : null, numThAlign: numTh ? getComputedStyle(numTh).textAlign : null,
      numTdWidth: numTd?.getBoundingClientRect().width ?? null,
      renameButtons: table ? table.querySelectorAll('button.btn:not(.btn--ghost)').length : 0,
      renameGhosts: table ? table.querySelectorAll('button.btn.btn--ghost').length : 0,
      tableClass: table?.className ?? null,
      addAccount: foot ? {
        legend: foot.querySelector('legend')?.textContent?.trim() ?? null,
        inFieldsetInBody: !!foot.querySelector('.panel__body fieldset .form-grid'),
        fieldSpans: [...foot.querySelectorAll('.field')].map((el) => el.className),
        footRule: foot.querySelector('.panel__foot') ? getComputedStyle(foot.querySelector('.panel__foot') as HTMLElement).borderTopWidth : null,
        footButtons: [...foot.querySelectorAll('.panel__foot .btn')].map((b) => b.className + ' | ' + b.textContent?.trim())
      } : null,
      footInputs,
      primaries: document.querySelectorAll('.btn--primary').length
    };
  });

  // 54: Editor line table with the Konto select (draft with two lines), 1440.
  await page.goto(`${BASE}/fakturaer/${draft.id}`);
  await page.waitForLoadState('networkidle');
  await shot('54-faktura-kladde-konto'); log('54');
  await page.locator('fieldset:has(table.lines)').screenshot({ path: path.join(OUT, '54b-faktura-kladde-konto-zoom.png') }); log('54b');
  const editorProbe = async () => page.evaluate(() => {
    const wrap = document.querySelector('fieldset .table-wrap') as HTMLElement;
    const table = wrap.querySelector('table.lines') as HTMLElement;
    const panel = document.querySelector('.layout-8-4 > .panel') as HTMLElement;
    const desc = document.querySelector('input[aria-label="Beskrivelse, linje 1"]') as HTMLElement;
    const sel = document.querySelector('select[aria-label="Konto, linje 1"]') as HTMLElement;
    const fjern = document.querySelector('table.lines .row-actions .btn') as HTMLElement;
    const wr = wrap.getBoundingClientRect();
    const fr = fjern.getBoundingClientRect();
    return {
      viewport: innerWidth,
      gridColumns: getComputedStyle(document.querySelector('.layout-8-4') as HTMLElement).gridTemplateColumns,
      panelWidth: panel.getBoundingClientRect().width,
      wrapClientWidth: wrap.clientWidth, tableScrollWidth: wrap.scrollWidth, hiddenPx: wrap.scrollWidth - wrap.clientWidth,
      descInputWidth: desc.getBoundingClientRect().width, kontoSelectWidth: sel.getBoundingClientRect().width,
      fjernVisibleInWrap: fr.right <= wr.right + 0.5,
      pageHScroll: document.documentElement.scrollWidth - innerWidth,
      // pass 2: the select sits under the description in a .cell-stack
      stack: (() => { const st = desc.closest('.cell-stack') as HTMLElement | null; const dr = desc.getBoundingClientRect(); const sr = sel.getBoundingClientRect(); const row = desc.closest('tr') as HTMLElement;
        return { hasStack: !!st, gap: st ? getComputedStyle(st).gap : null, selectLeftMatchesDesc: Math.abs(sr.left - dr.left) < 0.5, selectRightMatchesDesc: Math.abs(sr.right - dr.right) < 0.5, selectTopMinusDescBottom: sr.top - dr.bottom, rowHeight: row.getBoundingClientRect().height, cols: (row.parentElement as HTMLElement).parentElement!.querySelectorAll('thead th').length }; })()
    };
  });
  const editorAt: Record<string, unknown> = {};
  for (const w of [1440, 1420, 1419, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    editorAt[String(w)] = await editorProbe();
  }
  measure.editor = editorAt;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('fieldset:has(table.lines)').screenshot({ path: path.join(OUT, '54c-faktura-kladde-konto-1280-zoom.png') }); log('54c');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 55: Expense form with the Konto select (1440) plus the expense detail form.
  await page.goto(`${BASE}/udgifter`);
  await page.waitForLoadState('networkidle');
  await page.locator('form[action="?/create"]').screenshot({ path: path.join(OUT, '55-udgift-form-konto.png') }); log('55');
  measure.expenseForm = await page.evaluate(() => {
    const sel = document.querySelector('#accountId') as HTMLElement;
    const field = sel.closest('.field') as HTMLElement;
    return { selectWidth: sel.getBoundingClientRect().width, fieldClass: field.className, selectFont: getComputedStyle(sel).fontFamily.slice(0, 40), optionSample: (sel as HTMLSelectElement).options[0]?.text };
  });

  // 56–58: the three new report screens at 1152; 59–61 at 1280.
  for (const [w, prefix] of [[1152, '5'], [1280, '6']] as const) {
    await page.setViewportSize({ width: w, height: 900 });
    const names: [string, string][] = [
      [`${prefix}6-resultat-${w}`, '/resultat?year=2026'],
      [`${prefix}7-cashflow-${w}`, '/cashflow'],
      [`${prefix}8-balance-${w}`, '/balance']
    ];
    for (const [name, url] of names) {
      await page.goto(`${BASE}${url}`);
      await page.waitForLoadState('networkidle');
      await shot(name); log(name);
    }
  }
  // Cashflow / Resultat table geometry at 1440 / 1280 / 1152.
  const tablesAt: Record<string, unknown> = {};
  for (const w of [1440, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    const per: Record<string, unknown> = {};
    for (const url of ['/cashflow', '/resultat?year=2026', '/balance']) {
      await page.goto(`${BASE}${url}`);
      await page.waitForLoadState('networkidle');
      per[url] = await page.evaluate(() => ({
        tables: [...document.querySelectorAll('.table-wrap')].map((wrap) => {
          const t = wrap.querySelector('table') as HTMLTableElement;
          return { cols: t.tHead?.rows[0].cells.length ?? 0, wrap: wrap.clientWidth, table: t.getBoundingClientRect().width, hiddenPx: wrap.scrollWidth - wrap.clientWidth };
        }),
        grid66: [...document.querySelectorAll('.layout-6-6')].map((g) => getComputedStyle(g).gridTemplateColumns),
        kpis: [...document.querySelectorAll('.kpis')].map((g) => getComputedStyle(g).gridTemplateColumns),
        segments: [...document.querySelectorAll('.pagehead__actions .segment > *')].slice(0, 2).map((a) => getComputedStyle(a).fontFamily.slice(0, 30)),
        hintAmountFonts: [...document.querySelectorAll('.totals__row dt .hint')].map((h) => ({ text: h.textContent?.trim().slice(0, 60), font: getComputedStyle(h).fontFamily.slice(0, 30), monoSpans: h.querySelectorAll('.mono').length, monoFont: h.querySelector('.mono') ? getComputedStyle(h.querySelector('.mono') as HTMLElement).fontFamily.slice(0, 30) : null })),
        sumDd: [...document.querySelectorAll('.totals__row--sum dd')].map((d) => ({ text: d.textContent?.trim(), weight: getComputedStyle(d).fontWeight, children: d.children.length })),
        primaries: [...document.querySelectorAll('.btn--primary')].map((b) => ({ text: b.textContent?.trim(), h: b.getBoundingClientRect().height })),
        pageHScroll: document.documentElement.scrollWidth - innerWidth
      }));
    }
    tablesAt[String(w)] = per;
  }
  measure.reports = tablesAt;

  // 62: issued invoice with the new Konto column at 1152.
  await page.setViewportSize({ width: 1152, height: 900 });
  const issuedInv = invoices.find((i) => i.invoiceNumber === 1001) ?? invoices.find((i) => i.status === 'issued');
  if (issuedInv) {
    await page.goto(`${BASE}/fakturaer/${issuedInv.id}`);
    await page.waitForLoadState('networkidle');
    await shot('62-faktura-udstedt-konto-1152'); log('62');
    measure.issuedLines = await page.evaluate(() => [...document.querySelectorAll('.table-wrap')].map((wrap) => ({ wrap: wrap.clientWidth, hiddenPx: wrap.scrollWidth - wrap.clientWidth })));
  }

  // ------------------------------------------------------------------------
  // Spec v2 — pass 2: zooms of the changed regions, the credit-note refund
  // form, and a DOM-simulated reconciliation description in the movements
  // table (nothing is booked; the injected row is discarded on navigation).
  // ------------------------------------------------------------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  const creditNote = invoices.find((i) => i.isCreditNote && i.status === 'issued' && !i.paidDate) ?? invoices.find((i) => i.isCreditNote && i.status === 'issued'); // prefer one that still shows the refund form
  if (creditNote) {
    await page.goto(`${BASE}/fakturaer/${creditNote.id}`);
    await page.waitForLoadState('networkidle');
    await page.locator('.panel:has(.panel__foot)').first().screenshot({ path: path.join(OUT, '63-kreditnota-refunder-zoom.png') }); log('63');
    measure.creditNote = await page.evaluate(`(() => {
      const form = document.querySelector('.panel__foot form.paidform');
      const btn = form ? form.querySelector('button') : null;
      const input = form ? form.querySelector('input') : null;
      const label = form ? form.querySelector('label') : null;
      const facts = [...document.querySelectorAll('.facts dt')].map((d) => d.textContent.trim());
      return { hasForm: !!form, buttonClass: btn?.className ?? null, buttonText: btn?.textContent?.trim() ?? null, buttonH: btn?.getBoundingClientRect().height ?? null,
        inputClass: input?.className ?? null, inputW: input?.getBoundingClientRect().width ?? null, inputFont: input ? getComputedStyle(input).fontFamily.slice(0, 30) : null,
        labelHidden: label ? label.hasAttribute('hidden') : null, labelText: label?.textContent?.trim() ?? null, facts,
        footChildren: [...(document.querySelector('.panel__foot')?.children ?? [])].map((c) => c.className + ' | ' + c.textContent.trim().slice(0, 40)),
        primaries: document.querySelectorAll('.btn--primary').length };
    })()`);
  }

  // 64/65: cashflow at 1440 in its clean state — the form panel, the Pr. måned table, the movements panel.
  await page.goto(`${BASE}/cashflow`);
  await page.waitForLoadState('networkidle');
  await page.locator('form.panel[action="?/create"]').screenshot({ path: path.join(OUT, '64-cashflow-ny-bevaegelse-zoom.png') }); log('64');
  await page.locator('section:has(h2:has-text("Pr. måned")) .panel').screenshot({ path: path.join(OUT, '65-cashflow-pr-maaned-zoom.png') }); log('65');
  await page.locator('.panel:has(.panel__title:has-text("Bankbevægelser"))').screenshot({ path: path.join(OUT, '65b-cashflow-bevaegelser-zoom.png') }); log('65b');
  measure.cashflowMonthly = await page.evaluate(`(() => {
    const t = document.querySelector('section:has(h2) .panel table.data');
    const row = t.tBodies[0].rows[0]; const head = [...t.tHead.rows[0].cells].map((c) => c.textContent.trim());
    const subs = [...row.querySelectorAll('.cell-sub')].map((s) => ({ text: s.textContent.trim(), align: getComputedStyle(s).textAlign, font: getComputedStyle(s).fontFamily.slice(0, 30), size: getComputedStyle(s).fontSize, display: getComputedStyle(s).display }));
    return { head, rowHeights: [...t.tBodies[0].rows].map((r) => Math.round(r.getBoundingClientRect().height)), subs, tfootCells: [...t.tFoot.rows[0].cells].map((c) => c.textContent.trim()) };
  })()`);
  // Simulated reconciliation row (the text finance.ts now writes) at three widths — read-only, DOM only.
  const simulated: Record<string, unknown> = {};
  for (const w of [1440, 1280, 1152]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/cashflow`);
    await page.waitForLoadState('networkidle');
    simulated[String(w)] = await page.evaluate(`(() => {
      const panel = [...document.querySelectorAll('.panel')].find((p) => p.querySelector('.panel__title')?.textContent.trim() === 'Bankbevægelser');
      const wrap = panel.querySelector('.table-wrap'); const t = wrap.querySelector('table');
      const before = { wrap: wrap.clientWidth, hiddenPx: wrap.scrollWidth - wrap.clientWidth };
      const src = t.tBodies[0].rows[0]; const r = src.cloneNode(true);
      r.cells[0].textContent = '08.09.2026'; r.cells[1].textContent = 'Afstemning mod bank: saldo 104.293,89 kr.'; r.cells[2].textContent = 'Ejer (indskud/hævning)'; r.cells[3].textContent = '−1.234.567,89';
      t.tBodies[0].insertBefore(r, src);
      const after = { wrap: wrap.clientWidth, hiddenPx: wrap.scrollWidth - wrap.clientWidth, descLines: Math.round(r.cells[1].getBoundingClientRect().height / parseFloat(getComputedStyle(r.cells[1]).lineHeight)), descWhiteSpace: getComputedStyle(r.cells[1]).whiteSpace };
      const monthly = [...document.querySelectorAll('.table-wrap')].map((wr) => ({ cols: wr.querySelector('table').tHead.rows[0].cells.length, wrap: wr.clientWidth, hiddenPx: wr.scrollWidth - wr.clientWidth }));
      return { before, after, allTables: monthly };
    })()`);
  }
  measure.cashflowSimulatedReconciliation = simulated;
  await page.setViewportSize({ width: 1440, height: 900 });

  // 69: the add-account fieldset on Indstillinger; 70: editor line table at 1152 with the stacked select.
  await page.goto(`${BASE}/indstillinger`);
  await page.waitForLoadState('networkidle');
  await page.locator('form[action="?/addAccount"]').screenshot({ path: path.join(OUT, '69-indstillinger-ny-konto-zoom.png') }); log('69');
  await page.setViewportSize({ width: 1152, height: 900 });
  await page.goto(`${BASE}/fakturaer/${draft.id}`);
  await page.waitForLoadState('networkidle');
  await page.locator('fieldset:has(table.lines)').screenshot({ path: path.join(OUT, '70-faktura-kladde-konto-1152-zoom.png') }); log('70');

  // Udgifter primary height for comparison with the two new Bogfør buttons.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/udgifter`);
  await page.waitForLoadState('networkidle');
  measure.udgifterPrimary = await page.evaluate(() => { const b = document.querySelector('.btn--primary') as HTMLElement; return { text: b.textContent?.trim(), h: b.getBoundingClientRect().height }; });

  fs.writeFileSync(path.join(OUT, '..', 'measure-v2p2.json'), JSON.stringify(measure, null, 2));
  console.log(JSON.stringify(measure, null, 2));

  await ctx.request.delete(`${BASE}/api/invoices/${draft.id}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
