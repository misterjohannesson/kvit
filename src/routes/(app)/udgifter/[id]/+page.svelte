<script lang="ts">
  import { formatDate, formatOre } from '$lib/format';
  let { data, form } = $props();
  const e = $derived(data.expense);
  const v = (k: string, fallback: string) => form?.values?.[k] ?? fallback;
  const err = (k: string): string | undefined => form?.fields?.[k];
</script>

<svelte:head><title>Bilag {e.voucherNumber} · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow"><a href="/udgifter">Udgifter</a> · Bilag</p>
    <h1><span class="mono">{e.voucherNumber}</span> · {e.supplier}</h1>
  </div>
  <div class="pagehead__actions">
    {#if e.filePath}
      <a class="btn" href="/api/expenses/{e.id}/file" target="_blank" rel="noopener">Åbn bilag</a>
    {/if}
  </div>
</div>

{#if form?.error && !form?.fields}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="hint">Gemt.</p>{/if}

<div class="layout-8-4">
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Bilag</h3>
      <span class="panel__meta">{e.filePath ?? 'Ingen fil'}</span>
    </div>
    {#if data.fileKind === 'pdf'}
      <iframe class="fileframe" title="Bilag {e.voucherNumber}" src="/api/expenses/{e.id}/file#toolbar=0"></iframe>
    {:else if data.fileKind === 'image'}
      <div class="panel__body imgwrap"><img src="/api/expenses/{e.id}/file" alt="Bilag {e.voucherNumber}" /></div>
    {:else}
      <div class="panel__body"><p class="empty">Der er ikke uploadet et bilag endnu.</p></div>
    {/if}
    <form class="panel__foot" method="POST" action="?/upload" enctype="multipart/form-data">
      <div class="field spacer {err('file') ? 'field--error' : ''}">
        <label class="label" for="file">{e.filePath ? 'Erstat bilag' : 'Upload bilag'}</label>
        <input class="input input--md input--file" id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
        {#if err('file')}<span class="error">{err('file')}</span>{/if}
      </div>
      <button type="submit" class="btn">Upload</button>
    </form>
  </div>

  <form class="panel" method="POST" action="?/save">
    <div class="panel__head">
      <h3 class="panel__title">Oplysninger</h3>
      <span class="panel__meta">Bilag {e.voucherNumber}</span>
    </div>
    <div class="panel__body">
      <div class="stack">
        <div class="field {err('date') ? 'field--error' : ''}">
          <label class="label" for="date">Dato</label>
          <input class="input input--date" id="date" name="date" inputmode="numeric" value={v('date', formatDate(e.date))} placeholder="dd.mm.åååå" required />
          {#if err('date')}<span class="error">{err('date')}</span>{/if}
        </div>
        <div class="field {err('supplier') ? 'field--error' : ''}">
          <label class="label" for="supplier">Leverandør</label>
          <input class="input" id="supplier" name="supplier" value={v('supplier', e.supplier)} required />
          {#if err('supplier')}<span class="error">{err('supplier')}</span>{/if}
        </div>
        <div class="field {err('description') ? 'field--error' : ''}">
          <label class="label" for="description">Beskrivelse</label>
          <input class="input" id="description" name="description" value={v('description', e.description)} required />
          {#if err('description')}<span class="error">{err('description')}</span>{/if}
        </div>
        <div class="field {err('accountId') ? 'field--error' : ''}">
          <label class="label" for="accountId">Konto</label>
          <select class="select" id="accountId" name="accountId" required>
            {#each data.accounts as a (a.id)}
              <option value={a.id} selected={Number(v('accountId', String(e.accountId))) === a.id}>{a.number} {a.name}{a.archived ? ' (arkiveret)' : ''}</option>
            {/each}
          </select>
          {#if err('accountId')}<span class="error">{err('accountId')}</span>{/if}
        </div>
        <div class="field {err('amountExVat') ? 'field--error' : ''}">
          <label class="label" for="amountExVat">Beløb ekskl. moms</label>
          <input class="input input--num input--short" id="amountExVat" name="amountExVat" value={v('amountExVat', formatOre(e.amountExVatOre, false))} inputmode="decimal" required />
          {#if err('amountExVat')}<span class="error">{err('amountExVat')}</span>{/if}
        </div>
        <div class="field {err('vat') ? 'field--error' : ''}">
          <label class="label" for="vat">Moms</label>
          <input class="input input--num input--short" id="vat" name="vat" value={v('vat', formatOre(e.vatOre, false))} inputmode="decimal" required />
          {#if err('vat')}
            <span class="error">{err('vat')}</span>
          {:else}
            <span class="hint">Inkl. moms: <span class="mono">{formatOre(e.amountInclOre)}</span></span>
          {/if}
        </div>
        <div class="field {err('paidDate') ? 'field--error' : ''}">
          <label class="label" for="paidDate">Betalt <span class="label__optional">(valgfri)</span></label>
          <input class="input input--date" id="paidDate" name="paidDate" inputmode="numeric" value={v('paidDate', e.paidDate ? formatDate(e.paidDate) : '')} placeholder="dd.mm.åååå" />
          {#if err('paidDate')}<span class="error">{err('paidDate')}</span>{/if}
        </div>
      </div>
    </div>
    <div class="panel__foot">
      <button type="submit" class="btn btn--primary btn--std">Gem</button>
    </div>
  </form>
</div>

<style>
  .imgwrap img { display: block; max-width: 100%; border: var(--border-hairline-style); }
  .stack { display: flex; flex-direction: column; gap: var(--space-5); }
  .input--file { padding-top: var(--space-1); }
  .panel__foot .field { align-items: flex-start; }
</style>
