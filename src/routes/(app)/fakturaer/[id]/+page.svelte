<script lang="ts">
  import { page } from '$app/state';
  import Badge from '$lib/components/Badge.svelte';
  import InvoiceEditor from '$lib/components/InvoiceEditor.svelte';
  import { formatCvr, formatDate, formatOre, formatQuantity, formatVatRate } from '$lib/format';
  let { data, form } = $props();

  const inv = $derived(data.invoice);
  const title = $derived(inv.isCreditNote ? 'Kreditnota' : 'Faktura');
  let confirmCredit = $state(false);
  const neg = (n: number) => (n < 0 ? 'num num--neg' : 'num');
</script>

<svelte:head><title>{inv.status === 'draft' ? 'Kladde' : `${title} ${inv.invoiceNumber}`} · Faktura</title></svelte:head>

{#if inv.status === 'draft'}
  <InvoiceEditor invoice={inv} customers={data.customers} nextNumber={data.nextNumber} problems={data.problems} error={form?.error} fieldErrors={form?.fields ?? {}} />
{:else}
  <div class="pagehead">
    <div>
      <p class="pagehead__eyebrow"><a href="/fakturaer">Fakturaer</a> · {title}</p>
      <h1><span class="mono">{inv.invoiceNumber}</span> · {inv.customerName}</h1>
    </div>
    <div class="pagehead__actions">
      <a class="btn" href="/api/invoices/{inv.id}/pdf?download=1" download>Download PDF</a>
    </div>
  </div>

  {#if page.url.searchParams.get('udstedt')}
    <p class="hint">Fakturaen er udstedt med nummer <span class="mono">{inv.invoiceNumber}</span>. PDF'en er gemt som det juridiske dokument og kan ikke genereres igen.</p>
  {/if}
  {#if form?.error}
    <p class="error">{form.error}</p>
  {/if}

  <div class="layout-8-4">
    <div class="panel">
      <div class="panel__head">
        <h3 class="panel__title">{title} {inv.invoiceNumber}</h3>
        <Badge invoice={inv} today={data.today} />
      </div>
      <div class="panel__body">
        <dl class="facts">
          <div><dt>Kunde</dt><dd>{inv.customer.name}<span class="cell-sub">{inv.customer.address}, {inv.customer.zip} {inv.customer.city}{#if inv.customer.cvr}{' · CVR '}<span class="mono nowrap">{formatCvr(inv.customer.cvr)}</span>{/if}</span></dd></div>
          <div><dt>{inv.isCreditNote ? 'Dato' : 'Fakturadato'}</dt><dd class="mono">{formatDate(inv.issueDate)}</dd></div>
          {#if !inv.isCreditNote}
            <div><dt>Forfaldsdato</dt><dd class="mono">{formatDate(inv.dueDate)}</dd></div>
            <div><dt>Betalt</dt><dd class="mono">{inv.paidDate ? formatDate(inv.paidDate) : '—'}</dd></div>
          {/if}
          <div><dt>Betalingsreference</dt><dd class="mono">{inv.paymentReference}</dd></div>
          <div><dt>Moms</dt><dd>{#if inv.vatExemptReason}Momsfri – {inv.vatExemptReason}{:else}<span class="mono">{formatVatRate(inv.vatRateBp)}</span>{/if}</dd></div>
          {#if inv.isCreditNote}
            <div><dt>Vedrører</dt><dd><a href="/fakturaer/{inv.creditsInvoiceId}">Faktura <span class="mono">{inv.creditsInvoiceNumber}</span></a></dd></div>
          {/if}
          {#if inv.status === 'credited'}
            <div><dt>Krediteret med</dt><dd><a href="/fakturaer/{inv.creditedByInvoiceId}">Kreditnota <span class="mono">{inv.creditedByNumber}</span></a></dd></div>
          {/if}
        </dl>
      </div>
      <div class="table-wrap">
        <table class="data data--dense">
          <thead>
            <tr>
              <th scope="col">Beskrivelse</th>
              <th scope="col" class="num">Antal</th>
              <th scope="col">Enhed</th>
              <th scope="col" class="num">Pris</th>
              <th scope="col" class="num">Beløb</th>
            </tr>
          </thead>
          <tbody>
            {#each inv.lines as l (l.id)}
              <tr>
                <td>{l.description}</td>
                <td class={neg(l.quantity)}>{formatQuantity(l.quantity)}</td>
                <td>{l.unit}</td>
                <td class="num">{formatOre(l.unitPriceOre, false)}</td>
                <td class={neg(l.lineTotalOre)}>{formatOre(l.lineTotalOre, false)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="panel__foot">
        {#if inv.status === 'issued' && !inv.isCreditNote}
          <button type="button" class="btn btn--danger spacer" disabled={confirmCredit} onclick={() => (confirmCredit = true)}>Opret kreditnota</button>
          {#if inv.paidDate}
            <span class="hint">Betalt <span class="mono">{formatDate(inv.paidDate)}</span></span>
          {:else}
            <form method="POST" action="?/paid" class="paidform">
              <label class="label" for="paidDate" hidden>Betalingsdato</label>
              <input class="input input--date" id="paidDate" name="paidDate" inputmode="numeric" value={formatDate(data.today)} placeholder="dd.mm.åååå" required />
              <button type="submit" class="btn">Markér som betalt</button>
            </form>
          {/if}
        {:else}
          <span class="hint spacer">Dokumentet er udstedt og kan ikke ændres.</span>
        {/if}
      </div>
    </div>

    <div class="panel">
      <div class="panel__head">
        <h3 class="panel__title">Opsummering</h3>
      </div>
      <div class="panel__body">
        <dl class="totals">
          <div class="totals__row"><dt>Subtotal</dt><dd class={inv.subtotalOre < 0 ? 'num--neg' : ''}>{formatOre(inv.subtotalOre, false)}</dd></div>
          <div class="totals__row"><dt>Moms {inv.vatExemptReason ? '0 %' : formatVatRate(inv.vatRateBp)}</dt><dd class={inv.vatOre < 0 ? 'num--neg' : ''}>{formatOre(inv.vatOre, false)}</dd></div>
          <div class="totals__row totals__row--sum"><dt>I alt</dt><dd class={inv.totalOre < 0 ? 'num--neg' : ''}>{formatOre(inv.totalOre, false)}</dd></div>
        </dl>
        {#if confirmCredit}
          <div class="confirmbox" role="alertdialog" aria-labelledby="credit-title">
            <p class="confirmbox__title" id="credit-title">Opret kreditnota?</p>
            <p class="hint">Der oprettes en kreditnota med nummer <span class="mono">{data.nextNumber}</span>, som modposterer alle linjer, og faktura <span class="mono">{inv.invoiceNumber}</span> markeres som krediteret. Begge dokumenter forbliver i nummerserien.</p>
            <form method="POST" action="?/credit" class="confirmbox__actions">
              <input type="hidden" name="expectedNumber" value={data.nextNumber} />
              <button type="button" class="btn" onclick={() => (confirmCredit = false)}>Annullér</button>
              <button type="submit" class="btn btn--danger">Opret kreditnota {data.nextNumber}</button>
            </form>
          </div>
        {:else}
          <p class="hint pdfhint">
            PDF gemt som <span class="mono">{inv.pdfPath}</span>. <a href="/api/invoices/{inv.id}/pdf" target="_blank" rel="noopener">Åbn PDF</a>
          </p>
        {/if}
      </div>
    </div>
  </div>

  <section>
    <div class="section__head">
      <h2>Dokument</h2>
    </div>
    <div class="panel">
      <iframe class="pdfframe" title="{title} {inv.invoiceNumber}" src="/api/invoices/{inv.id}/pdf#toolbar=0"></iframe>
    </div>
  </section>
{/if}

<style>
  .facts {
    margin: 0 0 var(--space-4);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4) var(--layout-column-gap);
  }
  .facts dt { font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-label); }
  .facts dd { margin: var(--space-1) 0 0; color: var(--text-primary); }
  .paidform { display: flex; align-items: center; gap: var(--space-2); }
  .pdfhint { margin: var(--space-4) 0 0; overflow-wrap: anywhere; }
</style>
