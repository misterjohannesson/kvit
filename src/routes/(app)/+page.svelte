<script lang="ts">
  import InvoiceTable from '$lib/components/InvoiceTable.svelte';
  import { formatOre, QUARTER_LABELS } from '$lib/format';
  let { data } = $props();

  const outstanding = $derived(data.unpaid.reduce((s, r) => s + r.totalOre, 0));
  const overdueSum = $derived(data.overdue.reduce((s, r) => s + r.totalOre, 0));
  const oldest = $derived(
    data.overdue.length
      ? Math.max(...data.overdue.map((r) => Math.round((Date.parse(data.today) - Date.parse(r.dueDate)) / 86400000)))
      : 0
  );
</script>

<svelte:head><title>Overblik · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Regnskabsår {data.quarter.year}</p>
    <h1>Overblik</h1>
  </div>
  <div class="pagehead__actions">
    <a class="btn" href="/fakturaer">Fakturaer</a>
  </div>
</div>

<section class="kpis" aria-label="Nøgletal">
  <div class="kpi">
    <div class="kpi__label">Udestående</div>
    <div class="kpi__value">{formatOre(outstanding, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">{data.unpaid.length} ubetalte fakturaer</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Forfaldent</div>
    <div class="kpi__value {overdueSum > 0 ? 'kpi__value--neg' : ''}">{formatOre(overdueSum, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">{data.overdue.length} fakturaer{data.overdue.length ? ` · ældste +${oldest} dage` : ''}</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Omsætning år til dato</div>
    <div class="kpi__value">{formatOre(data.ytd.revenueExVatOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">ekskl. moms · {data.ytd.invoiceCount} udstedte dokumenter</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Moms at afregne, {data.quarter.quarter}. kvartal</div>
    <div class="kpi__value {data.vat.netVatOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(data.vat.netVatOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">salgsmoms {formatOre(data.vat.salesVatOre, false)} − købsmoms {formatOre(data.vat.purchaseVatOre, false)}</div>
  </div>
</section>

<section>
  <div class="section__head">
    <h2>Ubetalte fakturaer</h2>
    <p>Fakturaer uden registreret betaling. Forfaldne er markeret med status.</p>
  </div>
  <div class="panel">
    <InvoiceTable rows={data.unpaid} today={data.today} footer="{data.unpaid.length} ubetalte" empty="Ingen ubetalte fakturaer." />
  </div>
</section>

<section class="layout-6-6">
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Moms, {QUARTER_LABELS[data.quarter.quarter]} {data.quarter.year}</h3>
      <a class="panel__meta" href="/moms?year={data.quarter.year}&quarter={data.quarter.quarter}">Se momsindberetning</a>
    </div>
    <div class="panel__body">
      <dl class="totals">
        <div class="totals__row"><dt>Salgsmoms</dt><dd>{formatOre(data.vat.salesVatOre)}</dd></div>
        <div class="totals__row"><dt>Købsmoms</dt><dd>{formatOre(data.vat.purchaseVatOre)}</dd></div>
        <div class="totals__row totals__row--sum"><dt>Momstilsvar</dt><dd class={data.vat.netVatOre < 0 ? 'num--neg' : ''}>{formatOre(data.vat.netVatOre)}</dd></div>
      </dl>
    </div>
  </div>
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">År til dato {data.ytd.year}</h3>
      <span class="panel__meta">ekskl. moms</span>
    </div>
    <div class="panel__body">
      <dl class="totals">
        <div class="totals__row"><dt>Omsætning</dt><dd>{formatOre(data.ytd.revenueExVatOre)}</dd></div>
        <div class="totals__row"><dt>Udgifter ({data.ytd.expenseCount} bilag)</dt><dd>{formatOre(data.ytd.expensesExVatOre)}</dd></div>
        <div class="totals__row"><dt>Salgsmoms i alt</dt><dd>{formatOre(data.ytd.salesVatOre)}</dd></div>
        <div class="totals__row"><dt>Købsmoms i alt</dt><dd>{formatOre(data.ytd.purchaseVatOre)}</dd></div>
        <div class="totals__row totals__row--sum"><dt>Resultat</dt><dd class={data.ytd.resultExVatOre < 0 ? 'num--neg' : ''}>{formatOre(data.ytd.resultExVatOre)}</dd></div>
      </dl>
    </div>
  </div>
</section>

<style>
  .layout-6-6 {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--layout-column-gap);
    align-items: start;
  }
</style>
