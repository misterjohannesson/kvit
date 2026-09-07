<script lang="ts">
  import { formatDate, formatOre } from '$lib/format';
  let { data, form } = $props();
  const v = (k: string, fallback = '') => form?.values?.[k] ?? fallback;
  const sum = (k: 'amountExVatOre' | 'vatOre' | 'amountInclOre') => data.rows.reduce((s, r) => s + r[k], 0);
</script>

<svelte:head><title>Udgifter · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Køb</p>
    <h1>Udgifter</h1>
  </div>
  <div class="pagehead__actions">
    <a class="btn" href="#ny-udgift">Ny udgift</a>
  </div>
</div>

<section>
  <div class="panel">
    <div class="toolbar">
      <div class="segment" role="group" aria-label="År">
        <a href="/udgifter" aria-current={!data.year ? 'true' : undefined} class="segment__link">Alle år</a>
        {#each data.years as y (y)}
          <a href="/udgifter?year={y}" aria-current={data.year === y ? 'true' : undefined} class="segment__link mono">{y}</a>
        {/each}
      </div>
      <div class="toolbar__spacer"></div>
      <span class="panel__meta">{data.rows.length} bilag</span>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th scope="col">Bilag</th>
            <th scope="col">Dato</th>
            <th scope="col">Leverandør</th>
            <th scope="col">Kategori</th>
            <th scope="col">Betalt</th>
            <th scope="col" class="num">Beløb ekskl.</th>
            <th scope="col" class="num">Moms</th>
            <th scope="col" class="num">Beløb i alt</th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#if data.rows.length === 0}
            <tr><td colspan="9" class="empty">Ingen udgifter endnu.</td></tr>
          {/if}
          {#each data.rows as r (r.id)}
            <tr class="rowlink" onclick={() => (location.href = `/udgifter/${r.id}`)}>
              <td class="mono">{r.voucherNumber}</td>
              <td class="mono">{formatDate(r.date)}</td>
              <td>{r.supplier}<span class="cell-sub">{r.description}</span></td>
              <td>{r.category}</td>
              <td class="mono">{r.paidDate ? formatDate(r.paidDate) : '—'}</td>
              <td class="num">{formatOre(r.amountExVatOre, false)}</td>
              <td class="num">{formatOre(r.vatOre, false)}</td>
              <td class="num">{formatOre(r.amountInclOre, false)}</td>
              <td>
                <div class="row-actions">
                  <a class="btn btn--ghost btn--sm" href="/udgifter/{r.id}" onclick={(e) => e.stopPropagation()}>{r.filePath ? 'Vis bilag' : 'Vis'}</a>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
        {#if data.rows.length > 0}
          <tfoot>
            <tr>
              <td colspan="5">{data.rows.length} bilag{data.year ? ` · ${data.year}` : ''}</td>
              <td class="num">{formatOre(sum('amountExVatOre'), false)}</td>
              <td class="num">{formatOre(sum('vatOre'), false)}</td>
              <td class="num">{formatOre(sum('amountInclOre'), false)}</td>
              <td></td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
  </div>
</section>

<section id="ny-udgift">
  <div class="section__head">
    <h2>Ny udgift</h2>
    <p>Bilaget får næste bilagsnummer ved oprettelse. Momsen indtastes manuelt fra bilaget – udenlandske køb og repræsentation følger ikke 25 %.</p>
  </div>
  <form class="panel" method="POST" action="?/create" enctype="multipart/form-data">
    <div class="panel__body">
      {#if form?.error}
        <p class="error formerror">{form.error}</p>
      {/if}
      <div class="form-grid">
        <div class="field field--span-3">
          <label class="label" for="date">Dato</label>
          <input class="input input--date" id="date" name="date" type="date" value={v('date', data.today)} required />
        </div>
        <div class="field field--span-5">
          <label class="label" for="supplier">Leverandør</label>
          <input class="input" id="supplier" name="supplier" value={v('supplier')} required />
        </div>
        <div class="field field--span-4">
          <label class="label" for="category">Kategori</label>
          <input class="input" id="category" name="category" list="categories" value={v('category')} required autocomplete="off" />
          <datalist id="categories">
            {#each data.categories as c (c)}<option value={c}></option>{/each}
          </datalist>
        </div>
        <div class="field field--span-12">
          <label class="label" for="description">Beskrivelse</label>
          <input class="input input--wide" id="description" name="description" value={v('description')} required />
        </div>
        <div class="field field--span-3">
          <label class="label" for="amountExVat">Beløb ekskl. moms</label>
          <input class="input input--num input--short" id="amountExVat" name="amountExVat" value={v('amountExVat')} inputmode="decimal" placeholder="0,00" required />
        </div>
        <div class="field field--span-3">
          <label class="label" for="vat">Moms</label>
          <input class="input input--num input--short" id="vat" name="vat" value={v('vat')} inputmode="decimal" placeholder="0,00" required />
          <span class="hint">Som anført på bilaget. 0,00 ved udenlandske køb.</span>
        </div>
        <div class="field field--span-3">
          <label class="label" for="paidDate">Betalt <span class="label__optional">(valgfri)</span></label>
          <input class="input input--date" id="paidDate" name="paidDate" type="date" value={v('paidDate')} />
        </div>
        <div class="field field--span-3">
          <label class="label" for="file">Bilag <span class="label__optional">(valgfri)</span></label>
          <input class="input input--file" id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" />
          <span class="hint">PDF, JPG eller PNG.</span>
        </div>
      </div>
    </div>
    <div class="panel__foot">
      <button type="submit" class="btn btn--primary">Bogfør udgift</button>
    </div>
  </form>
</section>

<style>
  .rowlink { cursor: pointer; }
  .empty { text-align: center; color: var(--text-secondary); padding: var(--space-6) var(--table-cell-pad-x); }
  .segment__link { display: inline-flex; align-items: center; text-decoration: none; }
  .segment__link:hover { text-decoration: none; color: var(--text-primary); }
  .formerror { margin: 0 0 var(--space-4); }
  .input--wide { max-width: none; }
  .input--file { padding-top: var(--space-1); }
</style>
