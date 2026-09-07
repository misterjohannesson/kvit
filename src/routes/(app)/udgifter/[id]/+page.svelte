<script lang="ts">
  import { formatOre } from '$lib/format';
  let { data, form } = $props();
  const e = $derived(data.expense);
</script>

<svelte:head><title>Bilag {e.voucherNumber} · Faktura</title></svelte:head>

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

{#if form?.error}<p class="error">{form.error}</p>{/if}
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
      <div class="panel__body"><p class="hint">Der er ikke uploadet et bilag endnu.</p></div>
    {/if}
    <form class="panel__foot" method="POST" action="?/upload" enctype="multipart/form-data">
      <label class="label spacer" for="file">{e.filePath ? 'Erstat bilag' : 'Upload bilag'}</label>
      <input class="input input--file" id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
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
        <div class="field">
          <label class="label" for="date">Dato</label>
          <input class="input input--date" id="date" name="date" type="date" value={e.date} required />
        </div>
        <div class="field">
          <label class="label" for="supplier">Leverandør</label>
          <input class="input" id="supplier" name="supplier" value={e.supplier} required />
        </div>
        <div class="field">
          <label class="label" for="description">Beskrivelse</label>
          <input class="input" id="description" name="description" value={e.description} required />
        </div>
        <div class="field">
          <label class="label" for="category">Kategori</label>
          <input class="input" id="category" name="category" list="categories" value={e.category} required autocomplete="off" />
          <datalist id="categories">
            {#each data.categories as c (c)}<option value={c}></option>{/each}
          </datalist>
        </div>
        <div class="field">
          <label class="label" for="amountExVat">Beløb ekskl. moms</label>
          <input class="input input--num input--short" id="amountExVat" name="amountExVat" value={formatOre(e.amountExVatOre, false)} inputmode="decimal" required />
        </div>
        <div class="field">
          <label class="label" for="vat">Moms</label>
          <input class="input input--num input--short" id="vat" name="vat" value={formatOre(e.vatOre, false)} inputmode="decimal" required />
          <span class="hint">Inkl. moms: <span class="mono">{formatOre(e.amountInclOre)}</span></span>
        </div>
        <div class="field">
          <label class="label" for="paidDate">Betalt <span class="label__optional">(valgfri)</span></label>
          <input class="input input--date" id="paidDate" name="paidDate" type="date" value={e.paidDate ?? ''} />
        </div>
      </div>
    </div>
    <div class="panel__foot">
      <button type="submit" class="btn">Gem</button>
    </div>
  </form>
</div>

<style>
  .fileframe { display: block; width: 100%; height: 80vh; border: 0; background: var(--bg-surface-sunk); }
  .imgwrap img { display: block; max-width: 100%; border: var(--border-hairline-style); }
  .stack { display: flex; flex-direction: column; gap: var(--space-5); }
  .input--file { padding-top: var(--space-1); max-width: 260px; }
</style>
