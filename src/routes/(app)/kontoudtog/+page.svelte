<script lang="ts">
  import { formatDate, formatOre } from '$lib/format';
  let { data } = $props();
  const l = $derived(data.ledger);
  const neg = (n: number) => (n < 0 ? 'num num--neg' : 'num');
  const kindLabel: Record<string, string> = { invoice: 'Faktura', credit_note: 'Kreditnota', expense: 'Udgift', movement: 'Bankbevægelse' };
  const movementLabel: Record<string, string> = { vat_payment: 'moms', owner: 'ejer', tax: 'skat', correction: 'korrektion', other: 'andet' };
  const csvHref = $derived(`/api/finance?view=ledger&from=${l.from}&to=${l.to}&format=csv`);
</script>

<svelte:head><title>Kontoudtog · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Rapporter</p>
    <h1>Kontoudtog</h1>
  </div>
  <div class="pagehead__actions">
    <div class="segment" role="group" aria-label="Periode">
      {#each data.presets as p (p.key)}
        <a href="/kontoudtog?period={p.key}" aria-current={data.period === p.key ? 'true' : undefined}>{p.label}</a>
      {/each}
    </div>
    <a class="btn btn--ghost" href={csvHref}>Hent CSV</a>
  </div>
</div>

<form class="panel rangeform" method="GET" action="/kontoudtog" aria-label="Egen periode">
  <input type="hidden" name="period" value="custom" />
  <div class="panel__body rangeform__body">
    <div class="field {data.dateError ? 'field--error' : ''}">
      <label class="label" for="from">Fra</label>
      <input class="input input--date" id="from" name="from" inputmode="numeric" value={formatDate(l.from)} placeholder="dd.mm.åååå" required />
    </div>
    <div class="field {data.dateError ? 'field--error' : ''}">
      <label class="label" for="to">Til</label>
      <input class="input input--date" id="to" name="to" inputmode="numeric" value={formatDate(l.to)} placeholder="dd.mm.åååå" required />
    </div>
    <button type="submit" class="btn" aria-current={data.period === 'custom' ? 'true' : undefined}>Vis periode</button>
    {#if data.dateError}<span class="error">{data.dateError}</span>{:else}<span class="hint">Viser <span class="mono">{formatDate(l.from)}</span> – <span class="mono">{formatDate(l.to)}</span></span>{/if}
  </div>
</form>

<section class="kpis kpis--4" aria-label="Saldo">
  <div class="kpi">
    <div class="kpi__label">Primo</div>
    <div class="kpi__value {l.primoOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(l.primoOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">saldo ved dagens begyndelse {formatDate(l.from)}</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Ind</div>
    <div class="kpi__value">{formatOre(l.inOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">betalte fakturaer og bevægelser ind</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Ud</div>
    <div class="kpi__value">{formatOre(l.outOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">betalte udgifter, refusioner og bevægelser ud</div>
  </div>
  <div class="kpi kpi--accent">
    <div class="kpi__label">Ultimo</div>
    <div class="kpi__value {l.ultimoOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(l.ultimoOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">saldo ved dagens slutning {formatDate(l.to)}</div>
  </div>
</section>

<p class="hint prose">
  Alle bevægelser på bankkontoen, som appen kender dem: fakturaer på betalingsdatoen, udgifter på betalingsdatoen, refusioner af
  kreditnotaer og alle bankbevægelser (moms, skat, ejer, korrektioner fra afstemning, andet). Primo er åbningssaldoen plus alt før
  periodens første dag; ultimo er primo plus periodens bevægelser.
  {#if l.from < l.openingBalanceDate}
    Åbningssaldoen gælder fra <span class="mono">{formatDate(l.openingBalanceDate)}</span>; bevægelser før den dato er allerede en del af saldoen og vises ikke.
  {/if}
</p>

<section>
  <div class="panel">
    <div class="table-wrap">
      <table class="data data--dense">
        <thead>
          <tr>
            <th scope="col">Dato</th>
            <th scope="col">Type</th>
            <th scope="col">Nr.</th>
            <th scope="col">Tekst</th>
            <th scope="col">Modpart</th>
            <th scope="col" class="num">Ind</th>
            <th scope="col" class="num">Ud</th>
            <th scope="col" class="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr class="balance">
            <td class="mono">{formatDate(l.from)}</td>
            <td colspan="4">Primo</td>
            <td></td>
            <td></td>
            <td class={neg(l.primoOre)}>{formatOre(l.primoOre, false)}</td>
          </tr>
          {#if l.rows.length === 0}
            <tr><td colspan="8" class="empty">Ingen bevægelser i perioden.</td></tr>
          {/if}
          {#each l.rows as r, i (i)}
            <tr class="rowlink" onclick={() => (location.href = r.href)}>
              <td class="mono">{formatDate(r.date)}</td>
              <td>{kindLabel[r.kind]}{r.movementKind ? ` · ${movementLabel[r.movementKind] ?? r.movementKind}` : ''}</td>
              <td class="mono"><a href={r.href} onclick={(e) => e.stopPropagation()}>{r.ref}</a></td>
              <td class="wrap">{r.text}</td>
              <td>{r.counterparty}</td>
              <td class="num">{r.amountOre >= 0 ? formatOre(r.amountOre, false) : ''}</td>
              <td class="num">{r.amountOre < 0 ? formatOre(-r.amountOre, false) : ''}</td>
              <td class={neg(r.balanceOre)}>{formatOre(r.balanceOre, false)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td class="mono">{formatDate(l.to)}</td>
            <td colspan="4">Ultimo · {l.rows.length} bevægelser</td>
            <td class="num">{formatOre(l.inOre, false)}</td>
            <td class="num">{formatOre(l.outOre, false)}</td>
            <td class={neg(l.ultimoOre)}>{formatOre(l.ultimoOre, false)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</section>

<style>
  .prose { max-width: var(--layout-prose-max); }
  .rangeform { margin-bottom: var(--space-6); }
  .rangeform__body { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-4); }
  .rangeform .field { width: auto; }
  .rangeform .hint, .rangeform .error { align-self: center; }
  tr.balance td { background: var(--bg-thead); font-weight: 600; }
</style>
