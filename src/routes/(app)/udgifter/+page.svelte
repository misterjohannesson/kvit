<script lang="ts">
  import DensityToggle from '$lib/components/DensityToggle.svelte';
  import { formatDate, formatOre } from '$lib/format';
  let { data, form } = $props();
  const v = (k: string, fallback = '') => form?.values?.[k] ?? fallback;
  const err = (k: string): string | undefined => form?.fields?.[k];
  const acc = (id: number) => data.accounts.find((a) => a.id === id);
  const sum = (k: 'amountExVatOre' | 'vatOre' | 'amountInclOre') => data.rows.reduce((s, r) => s + r[k], 0);
  // svelte-ignore state_referenced_locally
  let supplierChoice = $state(v('supplierId') || (form?.values?.supplier ? '__new__' : data.suppliers.length ? '' : '__new__'));
</script>

<svelte:head><title>Udgifter · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Køb</p>
    <h1>Udgifter</h1>
  </div>
  <div class="pagehead__actions">
    <a class="btn btn--ghost" href="/udgifter/rapport">Rapport</a>
    <a class="btn" href="#ny-udgift">Ny udgift</a>
  </div>
</div>

<section>
  <div class="panel">
    <div class="toolbar">
      <div class="segment" role="group" aria-label="År">
        <a href="/udgifter" aria-current={!data.year ? 'true' : undefined}>Alle år</a>
        {#each data.years as y (y)}
          <a href="/udgifter?year={y}" aria-current={data.year === y ? 'true' : undefined} class="mono">{y}</a>
        {/each}
      </div>
      <div class="toolbar__spacer"></div>
      <DensityToggle dense={data.dense} />
      <span class="panel__meta">{data.rows.length} bilag</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Bilag</th>
            <th scope="col">Dato</th>
            <th scope="col">Leverandør</th>
            <th scope="col">Konto</th>
            <th scope="col">Betalt</th>
            <th scope="col" class="num">Beløb ekskl.</th>
            <th scope="col" class="num">Moms</th>
            <th scope="col" class="num">Beløb i alt</th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#if data.rows.length === 0}
            <tr>
              <td colspan="9" class="empty">
                {data.year ? `Ingen udgifter i ${data.year}.` : 'Ingen udgifter endnu.'}
                <a class="btn btn--sm" href={data.year ? '/udgifter' : '#ny-udgift'}>{data.year ? 'Vis alle' : 'Ny udgift'}</a>
              </td>
            </tr>
          {/if}
          {#each data.rows as r (r.id)}
            <tr class="rowlink" onclick={() => (location.href = `/udgifter/${r.id}`)}>
              <td class="mono">{r.voucherNumber}</td>
              <td class="mono">{formatDate(r.date)}</td>
              <td>{r.supplier}<span class="cell-sub">{r.description}</span></td>
              <td><span class="mono">{acc(r.accountId)?.number ?? ''}</span> {acc(r.accountId)?.name ?? ''}</td>
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
    <p>Bilaget får næste bilagsnummer ved oprettelse og bogføres på en omkostningskonto. Momsen indtastes manuelt fra bilaget – udenlandske køb og repræsentation følger ikke 25 %.</p>
  </div>
  <form class="panel" method="POST" action="?/create" enctype="multipart/form-data">
    <div class="panel__body">
      {#if form?.error && !form?.fields}
        <p class="error formerror">{form.error}</p>
      {/if}
      <div class="form-grid">
        <div class="field field--span-3 {err('date') ? 'field--error' : ''}">
          <label class="label" for="date">Dato</label>
          <input class="input input--date" id="date" name="date" inputmode="numeric" value={v('date', formatDate(data.today))} placeholder="dd.mm.åååå" required />
          {#if err('date')}<span class="error">{err('date')}</span>{/if}
        </div>
        <div class="field field--span-5 {err('supplier') ? 'field--error' : ''}">
          <label class="label" for="supplierId">Leverandør</label>
          <div class="supplier-pick">
            <select class="select" id="supplierId" name="supplierId" bind:value={supplierChoice} required>
              <option value="" disabled>Vælg leverandør …</option>
              {#each data.suppliers as s (s.id)}<option value={String(s.id)}>{s.name}</option>{/each}
              <option value="__new__">+ Ny leverandør</option>
            </select>
            {#if supplierChoice === '__new__'}
              <input class="input" id="supplier" name="supplier" value={v('supplier')} placeholder="Navn på den nye leverandør" aria-label="Ny leverandør" required />
            {/if}
          </div>
          {#if err('supplier')}<span class="error">{err('supplier')}</span>{:else if supplierChoice === '__new__'}<span class="hint">Leverandøren oprettes med et id og kan vælges næste gang.</span>{/if}
        </div>
        <div class="field field--span-4 {err('accountId') ? 'field--error' : ''}">
          <label class="label" for="accountId">Konto</label>
          <select class="select" id="accountId" name="accountId" required>
            {#each data.costAccounts as a (a.id)}
              <option value={a.id} selected={v('accountId') === String(a.id)}>{a.number} {a.name}</option>
            {/each}
          </select>
          {#if err('accountId')}<span class="error">{err('accountId')}</span>{/if}
        </div>
        <div class="field field--span-12 {err('description') ? 'field--error' : ''}">
          <label class="label" for="description">Beskrivelse</label>
          <input class="input input--wide" id="description" name="description" value={v('description')} required />
          {#if err('description')}<span class="error">{err('description')}</span>{/if}
        </div>
        <div class="field field--span-3 {err('amountExVat') ? 'field--error' : ''}">
          <label class="label" for="amountExVat">Beløb ekskl. moms</label>
          <input class="input input--num input--short" id="amountExVat" name="amountExVat" value={v('amountExVat')} inputmode="decimal" placeholder="0,00" required />
          {#if err('amountExVat')}<span class="error">{err('amountExVat')}</span>{/if}
        </div>
        <div class="field field--span-3 {err('vat') ? 'field--error' : ''}">
          <label class="label" for="vat">Moms</label>
          <input class="input input--num input--short" id="vat" name="vat" value={v('vat')} inputmode="decimal" placeholder="0,00" required />
          {#if err('vat')}
            <span class="error">{err('vat')}</span>
          {:else}
            <span class="hint">Som anført på bilaget. 0,00 ved udenlandske køb.</span>
          {/if}
        </div>
        <div class="field field--span-3 {err('paidDate') ? 'field--error' : ''}">
          <label class="label" for="paidDate">Betalt <span class="label__optional">(valgfri)</span></label>
          <input class="input input--date" id="paidDate" name="paidDate" inputmode="numeric" value={v('paidDate')} placeholder="dd.mm.åååå" />
          {#if err('paidDate')}<span class="error">{err('paidDate')}</span>{/if}
        </div>
        <div class="field field--span-3 {err('file') ? 'field--error' : ''}">
          <label class="label" for="file">Bilag <span class="label__optional">(valgfri)</span></label>
          <input class="input input--md input--file" id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" />
          {#if err('file')}
            <span class="error">{err('file')}</span>
          {:else}
            <span class="hint">PDF, JPG eller PNG.</span>
          {/if}
        </div>
      </div>
    </div>
    <div class="panel__foot">
      <button type="submit" class="btn btn--primary">Bogfør udgift</button>
    </div>
  </form>
</section>

<style>
  .input--file { padding-top: var(--space-1); }
  .supplier-pick { display: flex; flex-direction: column; gap: var(--space-2); }
</style>
