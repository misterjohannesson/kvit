<script lang="ts">
  import { formatDate, formatOre } from '$lib/format';
  let { data, form } = $props();
  const f = $derived(data.flow);
  const neg = (n: number) => (n < 0 ? 'num num--neg' : 'num');
  const v = (k: string, fallback = '') => form?.values?.[k] ?? fallback;
  const err = (k: string): string | undefined => form?.fields?.[k];
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-');
    const names = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${names[Number(m) - 1]} ${y}`;
  };
  const kindLabel = (k: string) => data.kinds.find((x) => x.value === k)?.label ?? k;
</script>

<svelte:head><title>Cashflow · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Rapporter</p>
    <h1>Cashflow</h1>
  </div>
</div>

<section class="kpis kpis--3" aria-label="Likviditet">
  <div class="kpi">
    <div class="kpi__label">Åbningssaldo</div>
    <div class="kpi__value {f.openingBalanceOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(f.openingBalanceOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">ved dagens begyndelse {formatDate(f.openingBalanceDate)} · ændres under Indstillinger</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Bankposition nu</div>
    <div class="kpi__value {f.closingPositionOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(f.closingPositionOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">åbningssaldo + alle betalte bevægelser</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Forventet ind</div>
    <div class="kpi__value">{formatOre(f.expected.reduce((s, e) => s + e.totalOre, 0), false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">{f.expected.reduce((s, e) => s + e.count, 0)} åbne fakturaer inkl. moms</div>
  </div>
</section>

<section>
  <div class="section__head">
    <h2>Pr. måned</h2>
    <p>Kassebasis: Ind = fakturaer efter betalingsdato (<span class="mono">{formatOre(f.months.reduce((s, m) => s + m.invoicesInOre, 0), false)}</span>) plus positive bankbevægelser (<span class="mono">{formatOre(f.months.reduce((s, m) => s + m.movementsInOre, 0), false)}</span>); Ud = udgifter efter betalingsdato (<span class="mono">{formatOre(f.months.reduce((s, m) => s + m.expensesOutOre, 0), false)}</span>), refunderede kreditnotaer (<span class="mono">{formatOre(f.months.reduce((s, m) => s + m.creditNotesOutOre, 0), false)}</span>) og negative bankbevægelser (<span class="mono">{formatOre(f.months.reduce((s, m) => s + m.movementsOutOre, 0), false)}</span>). Positionen løber fra åbningssaldoen. {#if f.excludedBeforeOpening.count > 0}<span class="mono">{f.excludedBeforeOpening.count}</span> bevægelser dateret før åbningssaldoen (<span class="mono">{formatOre(f.excludedBeforeOpening.netOre, false)}</span> netto) er allerede indeholdt i den og tælles ikke med.{/if}</p>
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
            <tr>
              <td class="mono">{monthLabel(m.month)}</td>
              <td class="num">{formatOre(m.inOre, false)}</td>
              <td class="num">{formatOre(m.outOre, false)}</td>
              <td class={neg(m.netOre)}>{formatOre(m.netOre, false)}</td>
              <td class={neg(m.positionOre)}>{formatOre(m.positionOre, false)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td>{f.months.length} måneder</td>
            <td class="num">{formatOre(f.months.reduce((s, m) => s + m.inOre, 0), false)}</td>
            <td class="num">{formatOre(f.months.reduce((s, m) => s + m.outOre, 0), false)}</td>
            <td class={neg(f.months.reduce((s, m) => s + m.netOre, 0))}>{formatOre(f.months.reduce((s, m) => s + m.netOre, 0), false)}</td>
            <td class={neg(f.closingPositionOre)}>{formatOre(f.closingPositionOre, false)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</section>

<section class="layout-6-6 layout-6-6--tables">
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Forventet</h3>
      <span class="panel__meta">åbne fakturaer efter forfaldsmåned</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Forfald</th>
            <th scope="col" class="num">Fakturaer</th>
            <th scope="col" class="num">Beløb inkl. moms</th>
          </tr>
        </thead>
        <tbody>
          {#if f.expected.length === 0}<tr><td colspan="3" class="empty">Ingen åbne fakturaer. <a class="btn btn--sm" href="/fakturaer">Fakturaer</a></td></tr>{/if}
          {#each f.expected as e (e.month)}
            <tr>
              <td class="mono">{monthLabel(e.month)}</td>
              <td class="num">{e.count}</td>
              <td class="num">{formatOre(e.totalOre, false)}</td>
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

