<script lang="ts">
  import { formatDate, formatOre, QUARTER_LABELS } from '$lib/format';
  let { data } = $props();
  const r = $derived(data.report);
  const neg = (n: number) => (n < 0 ? 'num num--neg' : 'num');
  const accountName = (id: number) => {
    const a = data.accounts.find((x) => x.id === id);
    return a ? `${a.number} ${a.name}` : '';
  };
</script>

<svelte:head><title>Momsindberetning · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Rapporter</p>
    <h1>Momsindberetning</h1>
  </div>
  <div class="pagehead__actions">
    <div class="segment" role="group" aria-label="År">
      {#each data.years as y (y)}
        <a href="/moms?year={y}&quarter={data.quarter}" aria-current={data.year === y ? 'true' : undefined} class="mono">{y}</a>
      {/each}
    </div>
    <div class="segment" role="group" aria-label="Kvartal">
      {#each [1, 2, 3, 4] as q (q)}
        <a href="/moms?year={data.year}&quarter={q}" aria-current={data.quarter === q ? 'true' : undefined}>{q}. kvartal</a>
      {/each}
    </div>
  </div>
</div>

<section class="kpis kpis--3" aria-label="Momsangivelse">
  <div class="kpi">
    <div class="kpi__label">Salgsmoms (udgående moms)</div>
    <div class="kpi__value {r.salesVatOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(r.salesVatOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">{r.salesRows.length} udstedte dokumenter · omsætning {formatOre(r.salesExVatOre, false)} ekskl. moms</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Købsmoms (indgående moms)</div>
    <div class="kpi__value">{formatOre(r.purchaseVatOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">{r.purchaseRows.length} bilag · køb {formatOre(r.purchasesExVatOre, false)} ekskl. moms</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Momstilsvar</div>
    <div class="kpi__value {r.netVatOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(r.netVatOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">{r.netVatOre < 0 ? 'negativt tilsvar – til udbetaling' : 'salgsmoms − købsmoms – til indbetaling'}</div>
  </div>
</section>

<p class="hint prose">
  {QUARTER_LABELS[data.quarter]} {data.year}: <span class="mono">{formatDate(r.from)}</span> – <span class="mono">{formatDate(r.to)}</span>.
  De tre tal svarer til felterne <em>Salgsmoms</em>, <em>Købsmoms</em> og <em>Momstilsvar</em> på momsangivelsen på skat.dk.
  Beregnet direkte fra data: fakturaer efter fakturadato (kreditnotaer modregnes), udgifter efter bilagsdato.
</p>

<section class="layout-6-6 layout-6-6--tables">
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Salg</h3>
      <span class="panel__meta">{r.salesRows.length} dokumenter</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Nr.</th>
            <th scope="col">Dato</th>
            <th scope="col">Kunde</th>
            <th scope="col" class="num">Ekskl. moms</th>
            <th scope="col" class="num">Moms</th>
          </tr>
        </thead>
        <tbody>
          {#if r.salesRows.length === 0}<tr><td colspan="5" class="empty">Ingen udstedte dokumenter i kvartalet. <a class="btn btn--sm" href="/fakturaer">Fakturaer</a></td></tr>{/if}
          {#each r.salesRows as s (s.id)}
            <tr>
              <td class="mono"><a href="/fakturaer/{s.id}">{s.invoiceNumber}</a></td>
              <td class="mono">{formatDate(s.issueDate)}</td>
              <td class="wrap">{s.customerName}{#if s.isCreditNote}<span class="cell-sub">Kreditnota til {s.creditsInvoiceNumber}</span>{:else if s.vatExemptReason}<span class="cell-sub">Momsfri: {s.vatExemptReason}</span>{/if}</td>
              <td class={neg(s.subtotalOre)}>{formatOre(s.subtotalOre, false)}</td>
              <td class={neg(s.vatOre)}>{formatOre(s.vatOre, false)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">Salgsmoms</td>
            <td class={neg(r.salesExVatOre)}>{formatOre(r.salesExVatOre, false)}</td>
            <td class={neg(r.salesVatOre)}>{formatOre(r.salesVatOre, false)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Køb</h3>
      <span class="panel__meta">{r.purchaseRows.length} bilag</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Bilag</th>
            <th scope="col">Dato</th>
            <th scope="col">Leverandør</th>
            <th scope="col" class="num">Ekskl. moms</th>
            <th scope="col" class="num">Moms</th>
          </tr>
        </thead>
        <tbody>
          {#if r.purchaseRows.length === 0}<tr><td colspan="5" class="empty">Ingen udgifter i kvartalet. <a class="btn btn--sm" href="/udgifter">Udgifter</a></td></tr>{/if}
          {#each r.purchaseRows as e (e.id)}
            <tr>
              <td class="mono"><a href="/udgifter/{e.id}">{e.voucherNumber}</a></td>
              <td class="mono">{formatDate(e.date)}</td>
              <td class="wrap">{e.supplier}<span class="cell-sub">{accountName(e.accountId)}</span></td>
              <td class="num">{formatOre(e.amountExVatOre, false)}</td>
              <td class="num">{formatOre(e.vatOre, false)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">Købsmoms</td>
            <td class="num">{formatOre(r.purchasesExVatOre, false)}</td>
            <td class="num">{formatOre(r.purchaseVatOre, false)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</section>

<style>
</style>
