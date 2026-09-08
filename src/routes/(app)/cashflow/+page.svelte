<script lang="ts">
  import { formatDate, formatMonth, formatOre } from '$lib/format';
  let { data, form } = $props();
  const f = $derived(data.flow);
  const fc = $derived(data.flow.forecast);
  const neg = (n: number) => (n < 0 ? 'num num--neg' : 'num');
  const v = (k: string, fallback = '') => form?.values?.[k] ?? fallback;
  const err = (k: string): string | undefined => form?.fields?.[k];
  const kindLabel = (k: string) => data.kinds.find((x) => x.value === k)?.label ?? k;
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  // Closed months show actuals; the current and future months show actuals to date plus the forecast.
  const rowIn = (m: (typeof f.months)[number]) => m.inOre + m.forecastInOre;
  const rowOut = (m: (typeof f.months)[number]) => m.outOre + m.forecastOutOre;
  const forecastRows = $derived(f.months.filter((m) => m.kind !== 'closed').length);
</script>

<svelte:head><title>Cashflow · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Rapporter</p>
    <h1>Cashflow</h1>
  </div>
</div>

<section class="kpis" aria-label="Likviditet">
  <div class="kpi">
    <div class="kpi__label">Åbningssaldo</div>
    <div class="kpi__value {f.openingBalanceOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(f.openingBalanceOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">ved dagens begyndelse {formatDate(f.openingBalanceDate)} · ændres under Indstillinger</div>
  </div>
  <div class="kpi kpi--accent">
    <div class="kpi__label">Bankposition nu</div>
    <div class="kpi__value {f.closingPositionOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(f.closingPositionOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">åbningssaldo + alle betalte bevægelser</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Forventet ind</div>
    <div class="kpi__value">{formatOre(fc.invoicesInOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">{sum(f.expected.map((e) => e.count))} åbne fakturaer inkl. moms</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Prognose ultimo {formatMonth(fc.toMonth)}</div>
    <div class="kpi__value {fc.projectedPositionOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(fc.projectedPositionOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">forventet ud: udgifter {formatOre(fc.expensesOutOre + fc.creditNotesOutOre, false)} · moms {formatOre(fc.vatOutOre, false)}</div>
  </div>
</section>

<section>
  <div class="section__head">
    <h2>Pr. måned</h2>
    <p>Betalte fakturaer, udgifter og bankbevægelser pr. betalingsdato, løbende fra åbningssaldoen. Tonede rækker er prognose: åbne fakturaer, ubetalte udgifter, kreditnotaer til refusion og moms efter frist.{#if f.excludedBeforeOpening.count > 0} <span class="mono">{f.excludedBeforeOpening.count}</span> bevægelser før åbningssaldoen tælles ikke med.{/if}</p>
  </div>
  <div class="panel">
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Måned</th>
            <th scope="col" class="num">Ind</th>
            <th scope="col" class="num">Ud</th>
            <th scope="col" class="num">Netto</th>
            <th scope="col" class="num">Position</th>
          </tr>
        </thead>
        <tbody>
          {#each f.months as m (m.month)}
            <tr class={m.kind === 'closed' ? '' : 'row--forecast'}>
              <td class="mono">{formatMonth(m.month)}{#if m.kind === 'current'}<span class="badge-note">igangværende</span>{:else if m.kind === 'forecast'}<span class="badge-note">prognose</span>{/if}</td>
              <td class="num">{formatOre(rowIn(m), false)}</td>
              <td class="num">{formatOre(rowOut(m), false)}</td>
              <td class={neg(rowIn(m) - rowOut(m))}>{formatOre(rowIn(m) - rowOut(m), false)}</td>
              <td class={neg(m.projectedPositionOre)}>{formatOre(m.projectedPositionOre, false)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td>{f.months.length} måneder{#if forecastRows > 0}, heraf {forecastRows} prognose{/if}</td>
            <td class="num">{formatOre(sum(f.months.map(rowIn)), false)}</td>
            <td class="num">{formatOre(sum(f.months.map(rowOut)), false)}</td>
            <td class={neg(sum(f.months.map((m) => rowIn(m) - rowOut(m))))}>{formatOre(sum(f.months.map((m) => rowIn(m) - rowOut(m))), false)}</td>
            <td class={neg(fc.projectedPositionOre)}>{formatOre(fc.projectedPositionOre, false)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</section>

<section class="layout-6-6 layout-6-6--tables">
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Prognose</h3>
      <span class="panel__meta">fra {formatMonth(fc.fromMonth)} · netto {formatOre(fc.netOre, false)}</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Måned</th>
            <th scope="col">Post</th>
            <th scope="col" class="num">Beløb inkl. moms</th>
          </tr>
        </thead>
        <tbody>
          {#if fc.items.length === 0}<tr><td colspan="3" class="empty">Ingen forventede bevægelser. <a class="btn btn--sm" href="/fakturaer">Fakturaer</a></td></tr>{/if}
          {#each fc.items as it (it.month + it.kind + it.label)}
            <tr>
              <td class="mono">{formatMonth(it.month)}</td>
              <td class="wrap">{it.label}{#if it.detail}<span class="badge-note">{it.detail}</span>{/if}</td>
              <td class={neg(it.amountOre)}>{formatOre(it.amountOre, false)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <form class="panel" method="POST" action="?/create">
    <div class="panel__head">
      <h3 class="panel__title">Ny bankbevægelse</h3>
      <span class="panel__meta">moms, ejer, skat, korrektion, andet</span>
    </div>
    <div class="panel__body">
      {#if form?.error && !form?.fields}<p class="error formerror">{form.error}</p>{/if}
      {#if form?.saved}<p class="hint formerror">Bevægelsen er bogført.</p>{/if}
      <div class="form-grid">
        <div class="field field--span-4 {err('date') ? 'field--error' : ''}">
          <label class="label" for="mv-date">Dato</label>
          <input class="input input--date" id="mv-date" name="date" inputmode="numeric" value={v('date', formatDate(data.today))} placeholder="dd.mm.åååå" required />
          {#if err('date')}<span class="error">{err('date')}</span>{/if}
        </div>
        <div class="field field--span-4 {err('amount') ? 'field--error' : ''}">
          <label class="label" for="mv-amount">Beløb</label>
          <input class="input input--num input--short" id="mv-amount" name="amount" value={v('amount')} inputmode="decimal" placeholder="−1.000,00" required />
          {#if err('amount')}<span class="error">{err('amount')}</span>{:else}<span class="hint">Positivt = ind, negativt = ud.</span>{/if}
        </div>
        <div class="field field--span-4">
          <label class="label" for="mv-kind">Type</label>
          <select class="select" id="mv-kind" name="kind">
            {#each data.kinds as k (k.value)}
              <option value={k.value} selected={v('kind', 'other') === k.value}>{k.label}</option>
            {/each}
          </select>
        </div>
        <div class="field field--span-12 {err('description') ? 'field--error' : ''}">
          <label class="label" for="mv-desc">Beskrivelse</label>
          <input class="input input--wide" id="mv-desc" name="description" value={v('description')} required />
          {#if err('description')}<span class="error">{err('description')}</span>{/if}
        </div>
      </div>
    </div>
    <div class="panel__foot">
      <button type="submit" class="btn btn--primary">Bogfør bevægelse</button>
    </div>
  </form>
</section>

<section>
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Bankbevægelser</h3>
      <span class="panel__meta">{data.movements.length} poster</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Dato</th>
            <th scope="col">Beskrivelse</th>
            <th scope="col">Type</th>
            <th scope="col" class="num">Beløb</th>
          </tr>
        </thead>
        <tbody>
          {#if data.movements.length === 0}<tr><td colspan="4" class="empty">Ingen bankbevægelser endnu.</td></tr>{/if}
          {#each data.movements as m (m.id)}
            <tr>
              <td class="mono">{formatDate(m.date)}</td>
              <td class="wrap">{m.description}</td>
              <td>{kindLabel(m.kind)}</td>
              <td class={neg(m.amountOre)}>{formatOre(m.amountOre, false)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>
