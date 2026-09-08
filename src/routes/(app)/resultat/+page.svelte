<script lang="ts">
  import { formatDate, formatOre } from '$lib/format';
  let { data } = $props();
  const r = $derived(data.report);
  const neg = (n: number) => (n < 0 ? 'num num--neg' : 'num');
  const href = (year: number, quarter: number | null) => `/resultat?year=${year}${quarter ? `&quarter=${quarter}` : ''}`;
  type Group = (typeof r)['revenueGroups'][number];
  /** Archived accounts without movement in the period are left out; a group shows only when something remains. */
  const visibleGroups = (groups: Group[]): Group[] =>
    groups
      .map((g) => ({ ...g, accounts: g.accounts.filter((a) => !a.account.archived || a.totalOre !== 0) }))
      .filter((g) => g.accounts.length > 0);
</script>

<svelte:head><title>Resultat · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Rapporter</p>
    <h1>Resultat</h1>
  </div>
  <div class="pagehead__actions">
    <div class="segment" role="group" aria-label="År">
      {#each data.years as y (y)}
        <a href={href(y, data.quarter)} aria-current={data.year === y ? 'true' : undefined} class="mono">{y}</a>
      {/each}
    </div>
    <div class="segment" role="group" aria-label="Periode">
      <a href={href(data.year, null)} aria-current={data.quarter === null ? 'true' : undefined}>Hele året</a>
      {#each [1, 2, 3, 4] as q (q)}
        <a href={href(data.year, q)} aria-current={data.quarter === q ? 'true' : undefined}>{q}. kvartal</a>
      {/each}
    </div>
  </div>
</div>

<section class="kpis kpis--3" aria-label="Resultat">
  <div class="kpi">
    <div class="kpi__label">Omsætning</div>
    <div class="kpi__value {r.revenueOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(r.revenueOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">ekskl. moms · kreditnotaer modregnet</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Omkostninger</div>
    <div class="kpi__value">{formatOre(r.costsOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">ekskl. moms</div>
  </div>
  <div class="kpi kpi--accent">
    <div class="kpi__label">Resultat før skat</div>
    <div class="kpi__value {r.resultOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(r.resultOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">omsætning − omkostninger</div>
  </div>
</section>

<p class="hint prose">
  Periode <span class="mono">{formatDate(r.from)}</span> – <span class="mono">{formatDate(r.to)}</span>, periodiseret: fakturaer efter fakturadato, udgifter efter bilagsdato. Ingen dobbelt bogføring – tallene er summer over de udstedte fakturaer og bogførte udgifter.
</p>

<section class="layout-6-6 layout-6-6--tables">
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Omsætning pr. konto</h3>
      <span class="panel__meta">{r.revenue.length} salgskonti</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Konto</th>
            <th scope="col">Navn</th>
            <th scope="col" class="num">Beløb ekskl.</th>
          </tr>
        </thead>
        <tbody>
          {#each visibleGroups(r.revenueGroups) as g (g.group)}
            {#if r.revenueGroups.length > 1}
              <tr class="group"><th scope="rowgroup" colspan="2">{g.group || 'Uden gruppe'}</th><td class={neg(g.totalOre)}>{formatOre(g.totalOre, false)}</td></tr>
            {/if}
            {#each g.accounts as row (row.account.id)}
              <tr class={row.account.archived ? 'archived' : ''}>
                <td class="mono">{row.account.number}</td>
                <td>{row.account.name}{row.account.archived ? ' (arkiveret)' : ''}</td>
                <td class={neg(row.totalOre)}>{formatOre(row.totalOre, false)}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
        <tfoot>
          <tr><td colspan="2">Omsætning i alt</td><td class={neg(r.revenueOre)}>{formatOre(r.revenueOre, false)}</td></tr>
        </tfoot>
      </table>
    </div>
  </div>
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Omkostninger pr. konto</h3>
      <span class="panel__meta">{r.costs.length} omkostningskonti</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Konto</th>
            <th scope="col">Navn</th>
            <th scope="col" class="num">Beløb ekskl.</th>
          </tr>
        </thead>
        <tbody>
          {#each visibleGroups(r.costGroups) as g (g.group)}
            {#if r.costGroups.length > 1}
              <tr class="group"><th scope="rowgroup" colspan="2">{g.group || 'Uden gruppe'}</th><td class={neg(g.totalOre)}>{formatOre(g.totalOre, false)}</td></tr>
            {/if}
            {#each g.accounts as row (row.account.id)}
              <tr class={row.account.archived ? 'archived' : ''}>
                <td class="mono">{row.account.number}</td>
                <td>{row.account.name}{row.account.archived ? ' (arkiveret)' : ''}</td>
                <td class={neg(row.totalOre)}>{formatOre(row.totalOre, false)}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
        <tfoot>
          <tr><td colspan="2">Omkostninger i alt</td><td class="num">{formatOre(r.costsOre, false)}</td></tr>
        </tfoot>
      </table>
    </div>
  </div>
</section>

<style>
  /* Group heading rows carry the subtotal; the accounts below are indented by the mono number column. */
  tr.group th { text-align: left; font-weight: 600; background: var(--bg-thead); }
  tr.group td { background: var(--bg-thead); font-weight: 600; }
  tr.archived td { color: var(--text-secondary); }
</style>

