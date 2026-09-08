<script lang="ts">
  import { page } from '$app/state';
  import Badge from '$lib/components/Badge.svelte';
  import InvoiceEditor from '$lib/components/InvoiceEditor.svelte';
  import { formatCvr, formatDate, formatOre, formatQuantity, formatVatRate, needsSending } from '$lib/format';
  let { data, form } = $props();

  const inv = $derived(data.invoice);
  const title = $derived(inv.isCreditNote ? 'Kreditnota' : 'Faktura');
  let confirmCredit = $state(false);
  let showPreview = $state(false);
  const neg = (n: number) => (n < 0 ? 'num num--neg' : 'num');
  const unsent = $derived(needsSending(inv, data.today));
  const attachmentPages = $derived(inv.attachments.reduce((n, a) => n + a.pages, 0));
  const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} kB`;
  // The key changes on every load, so the preview re-renders after a save.
  const previewSrc = $derived(`/api/invoices/${inv.id}/preview?v=${data.previewKey}#toolbar=0`);
</script>

<svelte:head><title>{inv.status === 'draft' ? 'Kladde' : `${title} ${inv.invoiceNumber}`} · Faktura</title></svelte:head>

{#if inv.status === 'draft'}
  <InvoiceEditor invoice={inv} customers={data.customers} accounts={data.revenueAccounts} defaultTermsDays={data.defaultTermsDays} nextNumber={data.nextNumber} problems={data.problems} error={form?.error} fieldErrors={form?.fields ?? {}} />

  <section class="layout-8-4">
    <div class="panel">
      <div class="panel__head">
        <h3 class="panel__title">Bilag</h3>
        <span class="panel__meta">{inv.attachments.length} PDF · {attachmentPages} sider</span>
      </div>
      <div class="panel__body">
        {#if form?.fields?.file}<p class="error formerror">{form.error}</p>{/if}
        {#if inv.attachments.length === 0}
          <p class="hint">Ingen bilag. Vedhæft fx en timeopgørelse eller en produktliste; den følger efter fakturasiderne i det udstedte dokument.</p>
        {:else}
          <ul class="attachlist">
            {#each inv.attachments as a (a.id)}
              <li>
                <span class="attachlist__name"><a href="/api/invoices/{inv.id}/attachments/{a.id}" target="_blank" rel="noopener">{a.name}</a></span>
                <span class="attachlist__meta">{a.pages} {a.pages === 1 ? 'side' : 'sider'} · {kb(a.sizeBytes)}</span>
                <form method="POST" action="?/detach">
                  <input type="hidden" name="attachmentId" value={a.id} />
                  <button type="submit" class="btn btn--ghost btn--sm">Fjern</button>
                </form>
              </li>
            {/each}
          </ul>
        {/if}
        <form method="POST" action="?/attach" enctype="multipart/form-data" class="attachform">
          <label class="label" for="attach-file" hidden>PDF-fil</label>
          <input class="input input--md" type="file" id="attach-file" name="file" accept="application/pdf,.pdf" required />
          <button type="submit" class="btn">Vedhæft PDF</button>
        </form>
        <span class="hint">Kun PDF, højst 20 MB pr. fil. Ved udstedelse samles faktura og bilag i ét dokument, som ikke kan ændres bagefter.</span>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head">
        <h3 class="panel__title">Udkast som PDF</h3>
        <span class="panel__meta">gemt kladde</span>
      </div>
      <div class="panel__body">
        <p class="hint">Viser den gemte kladde med bilag, mærket UDKAST og uden nummer. Gem først, hvis du har ændret noget.</p>
        <p class="previewactions">
          <button type="button" class="btn" onclick={() => (showPreview = !showPreview)}>{showPreview ? 'Skjul udkast' : 'Vis udkast'}</button>
          <a class="btn btn--ghost" href={previewSrc.replace('#toolbar=0', '')} target="_blank" rel="noopener">Åbn i ny fane</a>
        </p>
      </div>
    </div>
  </section>

  {#if showPreview}
    <section>
      <div class="section__head">
        <h2>Udkast</h2>
      </div>
      <div class="panel">
        <iframe class="pdfframe" title="Udkast til faktura" src={previewSrc}></iframe>
      </div>
    </section>
  {/if}
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

  {#if unsent}
    <div class="callout callout--alert" role="alert">
      <div class="callout__body">
        <p class="callout__title">Ikke sendt til kunden</p>
        <p>{title} <span class="mono">{inv.invoiceNumber}</span> er dateret <span class="mono">{formatDate(inv.issueDate)}</span> men er ikke markeret som sendt. Send PDF'en til {inv.customer.name}{#if inv.customer.email} (<span class="mono">{inv.customer.email}</span>){/if}, og markér den her.</p>
      </div>
      <form method="POST" action="?/sent" class="callout__actions">
        <label class="label" for="sentAt" hidden>Sendt den</label>
        <input class="input input--date" id="sentAt" name="sentAt" inputmode="numeric" value={formatDate(data.today)} placeholder="dd.mm.åååå" required />
        <button type="submit" class="btn btn--primary">Markér som sendt</button>
      </form>
    </div>
  {:else if !inv.sentAt}
    <p class="hint">Dokumentet er dateret <span class="mono">{formatDate(inv.issueDate)}</span>; markér det som sendt, når det er afsendt.</p>
    <form method="POST" action="?/sent" class="sentform">
      <label class="label" for="sentAt" hidden>Sendt den</label>
      <input class="input input--date" id="sentAt" name="sentAt" inputmode="numeric" value={formatDate(data.today)} placeholder="dd.mm.åååå" required />
      <button type="submit" class="btn">Markér som sendt</button>
    </form>
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
          {:else}
            <div><dt>Refunderet</dt><dd class="mono">{inv.paidDate ? formatDate(inv.paidDate) : '—'}</dd></div>
          {/if}
          <div><dt>Sendt</dt><dd class="mono">{inv.sentAt ? formatDate(inv.sentAt) : '—'}</dd></div>
          <div><dt>Betalingsreference</dt><dd class="mono">{inv.paymentReference || '—'}</dd></div>
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
              <th scope="col">Konto</th>
            </tr>
          </thead>
          <tbody>
            {#each inv.lines as l (l.id)}
              {@const acc = data.accounts.find((a) => a.id === l.accountId)}
              <tr>
                <td class="wrap">{l.description}</td>
                <td class={neg(l.quantity)}>{formatQuantity(l.quantity)}</td>
                <td>{l.unit}</td>
                <td class="num">{formatOre(l.unitPriceOre, false)}</td>
                <td class={neg(l.lineTotalOre)}>{formatOre(l.lineTotalOre, false)}</td>
                <td class="wrap"><span class="mono">{acc?.number ?? ''}</span> {acc?.name ?? ''}</td>
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
        {:else if inv.status === 'issued' && inv.isCreditNote}
          <span class="hint spacer">Kreditnotaen er udstedt og kan ikke ændres.</span>
          {#if inv.paidDate}
            <span class="hint">Refunderet <span class="mono">{formatDate(inv.paidDate)}</span></span>
          {:else if !inv.originalPaidDate}
            <span class="hint">Modregner en ubetalt faktura – intet at refundere.</span>
          {:else}
            <form method="POST" action="?/paid" class="paidform">
              <label class="label" for="paidDate" hidden>Refusionsdato</label>
              <input class="input input--date" id="paidDate" name="paidDate" inputmode="numeric" value={formatDate(data.today)} placeholder="dd.mm.åååå" required />
              <button type="submit" class="btn">Markér som refunderet</button>
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
          {#if inv.attachments.length > 0}
            <p class="hint pdfhint">Bilag i dokumentet ({attachmentPages} sider efter fakturaen):</p>
            <ul class="attachlist">
              {#each inv.attachments as a (a.id)}
                <li>
                  <span class="attachlist__name"><a href="/api/invoices/{inv.id}/attachments/{a.id}" target="_blank" rel="noopener">{a.name}</a></span>
                  <span class="attachlist__meta">{a.pages} {a.pages === 1 ? 'side' : 'sider'}</span>
                </li>
              {/each}
            </ul>
          {/if}
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
  .paidform, .sentform { display: flex; align-items: center; gap: var(--space-2); }
  .sentform { margin: 0 0 var(--space-6); }
  .pdfhint { margin: var(--space-4) 0 0; overflow-wrap: anywhere; }
  .previewactions { display: flex; gap: var(--space-2); margin: var(--space-3) 0 0; }
</style>
