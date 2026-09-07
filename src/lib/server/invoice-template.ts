import { formatDate, formatOre, formatQuantity, formatVatRate } from '../format';
import type { InvoiceDetail } from './services/invoices';
import { printTokenValue, tokenValue } from './assets';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function amount(ore: number): string {
  const neg = ore < 0;
  return `<span class="amt${neg ? ' amt--neg' : ''}">${esc(formatOre(ore, false))}</span>`;
}

/**
 * Invoice / credit note document. Tokens-only CSS under the print rules in
 * style.md §7. tokens.css is inlined so @media print re-points colours to ink.
 */
export function renderInvoiceHtml(
  inv: InvoiceDetail,
  s: Record<string, string>,
  tokensCss: string
): { html: string; footerTemplate: string } {
  const isCredit = inv.isCreditNote;
  const title = isCredit ? 'Kreditnota' : 'Faktura';
  const c = inv.customer;
  const cvr = (v: string) => v.replace(/\s/g, '').replace(/(\d{2})(?=\d)/g, '$1 ');

  const rows = inv.lines
    .map(
      (l) => `
        <tr>
          <td class="desc">${esc(l.description)}</td>
          <td class="num">${esc(formatQuantity(l.quantity))}</td>
          <td class="unit">${esc(l.unit)}</td>
          <td class="num">${amount(l.unitPriceOre)}</td>
          <td class="num">${amount(l.lineTotalOre)}</td>
        </tr>`
    )
    .join('');

  const vatLabel = inv.vatExemptReason ? 'Moms 0 %' : `Moms ${formatVatRate(inv.vatRateBp)}`;
  const exemptNote = inv.vatExemptReason
    ? `<p class="statutory">Momsfri: ${esc(inv.vatExemptReason)}</p>`
    : '';
  const creditRef = isCredit
    ? `<div class="kv"><dt>Vedrører faktura</dt><dd>${esc(inv.creditsInvoiceNumber)}</dd></div>`
    : '';

  const terms = Number(s.payment_terms_days) || 0;
  const paymentTerms = isCredit
    ? `Betalingsbetingelser: beløbet modregnes faktura nr. ${esc(inv.creditsInvoiceNumber)} eller udbetales · Forfaldsdato ${esc(formatDate(inv.dueDate))}`
    : `Betalingsbetingelser: netto ${terms} dage · Forfaldsdato ${esc(formatDate(inv.dueDate))}`;

  const html = `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="utf-8">
<title>${esc(title)} ${esc(inv.invoiceNumber)}</title>
<style>
${tokensCss}
</style>
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg-surface);
  color: var(--text-body);
  font-family: var(--font-ui);
  font-size: var(--print-text-size);
  line-height: var(--print-leading);
  -webkit-print-color-adjust: exact;
}
.doc { padding-bottom: var(--space-16); }
.amt, .num, .mono { font-family: var(--font-numeric); font-variant-numeric: tabular-nums; }
.amt--neg { color: var(--text-negative); }
.num { text-align: right; }

.head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-8); }
.sender { max-width: 50%; }
.sender__name { font-weight: var(--weight-semibold); color: var(--text-primary); }
.sender p, .buyer p { margin: 0; }
.sender__meta { color: var(--text-secondary); }

.title { text-align: right; }
.title h1 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-4xl);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
}
.kvlist { margin: 0; display: grid; grid-template-columns: auto auto; column-gap: var(--space-4); row-gap: var(--space-1); justify-content: end; }
.kv { display: contents; }
.kv dt { color: var(--text-secondary); text-align: right; }
.kv dd { margin: 0; font-family: var(--font-numeric); font-variant-numeric: tabular-nums; color: var(--text-primary); text-align: right; }

.buyer { margin-top: var(--space-10); }
.eyebrow {
  font-size: var(--print-text-small);
  color: var(--text-secondary);
  margin: 0 0 var(--space-1);
}
.buyer__name { font-weight: var(--weight-semibold); color: var(--text-primary); }

table.lines { width: 100%; border-collapse: collapse; margin-top: var(--space-10); }
table.lines thead { display: table-header-group; }
table.lines th {
  text-align: left;
  white-space: nowrap;
  font-size: var(--print-text-small);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-label);
  padding: var(--space-2) var(--space-2);
  border-top: var(--print-rule);
  border-bottom: var(--print-rule);
}
table.lines th.num { text-align: right; }
table.lines td {
  padding: var(--space-2) var(--space-2);
  border-bottom: var(--border-width) solid var(--border-hairline);
  vertical-align: top;
}
table.lines tr { page-break-inside: avoid; }
td.desc { width: 46%; }
td.unit { color: var(--text-secondary); }

.totals-wrap { display: flex; justify-content: flex-end; margin-top: var(--space-6); page-break-inside: avoid; }
.totals { width: 70mm; max-width: 70mm; margin: 0; }
.totals .row { display: grid; grid-template-columns: 1fr auto; column-gap: var(--space-4); align-items: baseline; padding: var(--space-1) var(--space-2); }
.totals .row dt { color: var(--text-secondary); }
.totals .row dd { margin: 0; text-align: right; }
.totals .row--sum { border-top: var(--print-rule); margin-top: var(--space-1); padding-top: var(--space-2); }
.totals .row--sum dt, .totals .row--sum dd { font-weight: var(--weight-semibold); color: var(--text-primary); }
.totals .row--sum dd { font-size: var(--text-lg); }

.statutory { font-size: var(--print-text-small); color: var(--text-body); margin: var(--space-4) 0 0; text-align: right; orphans: 3; widows: 3; }

.foot {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  border-top: var(--print-rule);
  padding-top: var(--space-2);
  font-size: var(--print-text-small);
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
  gap: var(--space-6);
  page-break-inside: avoid;
}
.foot p { margin: 0; }
.foot > div:last-child { flex-shrink: 0; white-space: nowrap; }
.foot .mono { color: var(--text-body); }
</style>
</head>
<body>
<div class="doc">
  <header class="head">
    <div class="sender">
      <p class="sender__name">${esc(s.company_name)}</p>
      <p>${esc(s.company_address)}</p>
      <p>${esc(s.company_zip)} ${esc(s.company_city)}</p>
      <p class="sender__meta">CVR-nr. <span class="mono">${esc(cvr(s.company_cvr))}</span></p>
    </div>
    <div class="title">
      <h1>${esc(title)}</h1>
      <dl class="kvlist">
        <div class="kv"><dt>${isCredit ? 'Kreditnotanr.' : 'Fakturanr.'}</dt><dd>${esc(inv.invoiceNumber)}</dd></div>
        ${creditRef}
        <div class="kv"><dt>${isCredit ? 'Dato' : 'Fakturadato'}</dt><dd>${esc(formatDate(inv.issueDate))}</dd></div>
        <div class="kv"><dt>Forfaldsdato</dt><dd>${esc(formatDate(inv.dueDate))}</dd></div>
      </dl>
    </div>
  </header>

  <section class="buyer">
    <p class="eyebrow">${isCredit ? 'Krediteres til' : 'Faktureres til'}</p>
    <p class="buyer__name">${esc(c.name)}</p>
    <p>${esc(c.address)}</p>
    <p>${esc(c.zip)} ${esc(c.city)}${c.country && c.country !== 'DK' ? `, ${esc(c.country)}` : ''}</p>
    ${c.cvr ? `<p>CVR-nr. <span class="mono">${esc(cvr(c.cvr))}</span></p>` : ''}
  </section>

  <table class="lines">
    <thead>
      <tr>
        <th>Beskrivelse</th>
        <th class="num">Antal</th>
        <th>Enhed</th>
        <th class="num">Enhedspris ekskl. moms</th>
        <th class="num">Beløb ekskl. moms</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>

  <div class="totals-wrap">
    <dl class="totals">
      <div class="row"><dt>Subtotal ekskl. moms</dt><dd>${amount(inv.subtotalOre)}</dd></div>
      <div class="row"><dt>${esc(vatLabel)}</dt><dd>${amount(inv.vatOre)}</dd></div>
      <div class="row row--sum"><dt>I alt inkl. moms, DKK</dt><dd>${amount(inv.totalOre)}</dd></div>
    </dl>
  </div>
  ${exemptNote}

  <footer class="foot">
    <div>
      <p>${paymentTerms}</p>
      <p>Betaling: <span class="mono">${esc(inv.paymentReference)}</span></p>
    </div>
    <div>
      <p>${esc(s.company_name)} · CVR <span class="mono">${esc(cvr(s.company_cvr))}</span></p>
      <p>${esc(title)} <span class="mono">${esc(inv.invoiceNumber)}</span></p>
    </div>
  </footer>
</div>
</body>
</html>`;

  // Chromium's footer template is a separate document without our stylesheet,
  // so the two values it needs are read from tokens.css and inlined.
  const small = tokenValue('--print-text-small');
  const side = tokenValue('--print-margin-side');
  const fontUi = tokenValue('--font-ui');
  const ink = printTokenValue('--text-secondary');
  const footerTemplate = `<div style="width:100%;text-align:right;padding-right:${side};font-size:${small};font-family:${fontUi};color:${ink};">Side <span class="pageNumber"></span> af <span class="totalPages"></span></div>`;

  return { html, footerTemplate };
}
