<script lang="ts">
  import { formatDate, formatOre } from '$lib/format';
  let { data, form } = $props();
  const r = $derived(data.report);
  const href = (year: number, quarter: number | null) => `/udgifter/rapport?year=${year}${quarter ? `&quarter=${quarter}` : ''}`;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];
  const cell = (ore: number) => (ore === 0 ? '' : formatOre(ore, false));
  const largest = $derived(r.suppliers[0]);
</script>

<svelte:head><title>Udgiftsrapport · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Rapporter</p>
    <h1>Udgiftsrapport</h1>
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

<section class="kpis kpis--4" aria-label="Udgifter i perioden">
  <div class="kpi kpi--accent">
    <div class="kpi__label">Udgifter</div>
    <div class="kpi__value">{formatOre(r.totalOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">ekskl. moms · købsmoms {formatOre(r.vatOre, false)}</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Bilag</div>
    <div class="kpi__value">{r.count}</div>
    <div class="kpi__sub">{formatDate(r.from)} – {formatDate(r.to)}</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Leverandører</div>
    <div class="kpi__value">{r.supplierCount}</div>
    <div class="kpi__sub">med bilag i perioden</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Største leverandør</div>
    <div class="kpi__value kpi__value--text">{largest ? largest.supplier.name : '—'}</div>
    <div class="kpi__sub">{largest ? `${formatOre(largest.totalOre, false)} kr. · ${largest.count} bilag` : 'ingen udgifter i perioden'}</div>
  </div>
</section>

<p class="hint prose">
  Hvad der er købt, hos hvem og hvornår: udgifter ekskl. moms pr. omkostningskonto og leverandør, måned for måned efter bilagsdato.
  Under hver konto står de leverandører, der er bogført på den, størst først.
</p>

<section>
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Pr. konto og leverandør</h3>
      <span class="panel__meta">{r.accounts.length} konti med bilag</span>
    </div>
    <div class="table-wrap">
      <table class="data data--dense matrix">
        <thead>
          <tr>
            <th scope="col">Konto / leverandør</th>
            {#each r.months as m (m)}<th scope="col" class="num">{monthLabel(m)}</th>{/each}
            <th scope="col" class="num">I alt</th>
            <th scope="col" class="num">Bilag</th>
          </tr>
        </thead>
        <tbody>
          {#if r.accounts.length === 0}
            <tr><td colspan={r.months.length + 3} class="empty">Ingen udgifter i perioden. <a class="btn btn--sm" href="/udgifter#ny-udgift">Ny udgift</a></td></tr>
          {/if}
          {#each r.accounts as a (a.account.id)}
            <tr class="group">
              <th scope="rowgroup"><span class="mono">{a.account.number}</span> {a.account.name}</th>
              {#each a.months as v, i (i)}<td class="num">{cell(v)}</td>{/each}
              <td class="num">{formatOre(a.totalOre, false)}</td>
              <td class="num">{a.count}</td>
            </tr>
            {#each a.suppliers as s (s.supplier.id)}
              <tr>
                <td class="sub">{s.supplier.name}</td>
                {#each s.months as v, i (i)}<td class="num">{cell(v)}</td>{/each}
                <td class="num">{formatOre(s.totalOre, false)}</td>
                <td class="num">{s.count}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
        {#if r.accounts.length > 0}
          <tfoot>
            <tr>
              <td>Udgifter i alt</td>
              {#each r.months as m, i (m)}<td class="num">{cell(r.accounts.reduce((s, a) => s + a.months[i], 0))}</td>{/each}
              <td class="num">{formatOre(r.totalOre, false)}</td>
              <td class="num">{r.count}</td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
  </div>
</section>

<section>
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Pr. leverandør</h3>
      <span class="panel__meta">størst først</span>
    </div>
    <div class="table-wrap">
      <table class="data data--dense matrix">
        <thead>
          <tr>
            <th scope="col">Leverandør / konti</th>
            {#each r.months as m (m)}<th scope="col" class="num">{monthLabel(m)}</th>{/each}
            <th scope="col" class="num">I alt</th>
            <th scope="col" class="num">Bilag</th>
          </tr>
        </thead>
        <tbody>
          {#if r.suppliers.length === 0}
            <tr><td colspan={r.months.length + 3} class="empty">Ingen udgifter i perioden.</td></tr>
          {/if}
          {#each r.suppliers as s (s.supplier.id)}
            <tr>
              <td>{s.supplier.name}<span class="cell-sub">{s.accounts.map((a) => `${a.number} ${a.name}`).join(', ')}</span></td>
              {#each s.months as v, i (i)}<td class="num">{cell(v)}</td>{/each}
              <td class="num">{formatOre(s.totalOre, false)}</td>
              <td class="num">{s.count}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section>
  <div class="section__head">
    <h2>Leverandører</h2>
    <p>Alle leverandører med antal bilag og beløb i alt. Omdøb en leverandør, og alle dens bilag følger med. En leverandør uden bilag kan slettes.</p>
  </div>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  {#if form?.saved}<p class="hint">Gemt.</p>{/if}
  <div class="panel">
    <div class="table-wrap">
      <table class="data data--dense">
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">Navn</th>
            <th scope="col" class="num">Bilag</th>
            <th scope="col" class="num">I alt ekskl.</th>
            <th scope="col">Seneste bilag</th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#if data.suppliers.length === 0}
            <tr><td colspan="6" class="empty">Ingen leverandører endnu – de oprettes fra udgiftsformularen.</td></tr>
          {/if}
          {#each data.suppliers as s (s.id)}
            <tr>
              <td class="mono">{s.id}</td>
              <td>
                <label class="label" for="sup-{s.id}" hidden>Navn</label>
                <input class="input input--cell" id="sup-{s.id}" name="name" value={s.name} form="sup-form-{s.id}" required maxlength="200" />
              </td>
              <td class="num">{s.usage}</td>
              <td class="num">{formatOre(s.totalExVatOre, false)}</td>
              <td class="mono">{s.lastDate ? formatDate(s.lastDate) : '—'}</td>
              <td>
                <div class="row-actions">
                  <form method="POST" action="?/renameSupplier" id="sup-form-{s.id}">
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" class="btn btn--ghost btn--sm">Omdøb</button>
                  </form>
                  {#if s.usage === 0}
                    <form method="POST" action="?/deleteSupplier">
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" class="btn btn--ghost btn--sm btn--danger" onclick={(e) => { if (!confirm(`Slet leverandøren ${s.name}?`)) e.preventDefault(); }}>Slet</button>
                    </form>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<style>
  .prose { max-width: var(--layout-prose-max); }
  .matrix tr.group th { text-align: left; font-weight: 600; background: var(--bg-thead); }
  .matrix tr.group td { background: var(--bg-thead); font-weight: 600; }
  .matrix td.sub { padding-left: calc(var(--space-6) + var(--space-2)); color: var(--text-secondary); }
  .kpi__value--text { font-size: var(--text-lg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-actions { display: flex; gap: var(--space-2); }
</style>
