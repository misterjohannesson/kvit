<script lang="ts">
  import { formatDate, formatOre } from '$lib/format';
  let { data, form } = $props();
  const b = $derived(data.balance);
  const neg = (n: number) => (n < 0 ? 'num--neg' : '');
</script>

<svelte:head><title>Balance · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Rapporter</p>
    <h1>Balance (forenklet)</h1>
  </div>
  <span class="panel__meta">Pr. {formatDate(b.asOf)}</span>
</div>

<p class="hint prose">
  En positionsopgørelse beregnet direkte fra data – ikke et årsregnskab. Likvider og debitorer på den ene side, kreditorer og skyldig moms på den anden.
</p>

<section class="layout-6-6">
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Aktiver</h3>
    </div>
    <div class="panel__body">
      <dl class="totals">
        <div class="totals__row"><dt>Likvider <span class="hint">(åbningssaldo {formatOre(b.openingBalanceOre, false)} + alle betalte bevægelser)</span></dt><dd class={neg(b.likviderOre)}>{formatOre(b.likviderOre)}</dd></div>
        <div class="totals__row"><dt>Debitorer <span class="hint">({b.openInvoices} åbne fakturaer inkl. moms)</span></dt><dd>{formatOre(b.debitorerOre)}</dd></div>
        <div class="totals__row totals__row--sum totals__row--sum-sm"><dt>Aktiver i alt</dt><dd class={neg(b.likviderOre + b.debitorerOre)}>{formatOre(b.likviderOre + b.debitorerOre)}</dd></div>
      </dl>
    </div>
  </div>
  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Forpligtelser</h3>
    </div>
    <div class="panel__body">
      <dl class="totals">
        <div class="totals__row"><dt>Kreditorer <span class="hint">({b.unpaidExpenses} ubetalte udgifter inkl. moms)</span></dt><dd>{formatOre(b.kreditorerOre)}</dd></div>
        <div class="totals__row"><dt>Skyldig moms <span class="hint">(momstilsvar til dato {formatOre(b.accruedVatOre, false)} − momsbetalinger {formatOre(-b.vatPaymentsOre, false)})</span></dt><dd class={neg(b.skyldigMomsOre)}>{formatOre(b.skyldigMomsOre)}</dd></div>
        <div class="totals__row totals__row--sum totals__row--sum-sm"><dt>Forpligtelser i alt</dt><dd>{formatOre(b.kreditorerOre + b.skyldigMomsOre)}</dd></div>
      </dl>
    </div>
  </div>
</section>

<section class="kpis kpis--1" aria-label="Nettoposition">
  <div class="kpi">
    <div class="kpi__label">Nettoposition</div>
    <div class="kpi__value {b.nettoOre < 0 ? 'kpi__value--neg' : ''}">{formatOre(b.nettoOre, false)}<span class="kpi__unit">kr.</span></div>
    <div class="kpi__sub">likvider + debitorer − kreditorer − skyldig moms</div>
  </div>
</section>

<section>
  <div class="section__head">
    <h2>Afstemning</h2>
    <p>Indtast bankens saldo. Afviger den fra Likvider, kan forskellen bogføres som en korrektion, så kassevisningerne igen svarer til banken. En månedlig vane.</p>
  </div>
  <div class="panel">
    {#if form?.booked}
      <div class="panel__body">
        <p class="hint">Korrektion bogført: <span class="mono">{formatOre(form.booked.amountOre)}</span> den <span class="mono">{formatDate(form.booked.date)}</span>. Likvider er nu <span class="mono">{formatOre(b.likviderOre)}</span>.</p>
      </div>
    {:else if form?.preview}
      <div class="panel__body">
        <dl class="totals">
          <div class="totals__row"><dt>Likvider ifølge appen</dt><dd>{formatOre(form.preview.likviderOre)}</dd></div>
          <div class="totals__row"><dt>Saldo ifølge banken</dt><dd>{formatOre(form.preview.actualOre)}</dd></div>
          <div class="totals__row totals__row--sum totals__row--sum-sm"><dt>Forskel</dt><dd class={neg(form.preview.differenceOre)}>{formatOre(form.preview.differenceOre)}</dd></div>
        </dl>
        {#if form.preview.differenceOre === 0}
          <p class="hint formerror">Saldoen stemmer. Intet at bogføre.</p>
        {:else}
          <div class="confirmbox" role="alertdialog" aria-labelledby="book-title">
            <p class="confirmbox__title" id="book-title">Bogfør korrektion?</p>
            <p class="hint">Der oprettes en bankbevægelse af typen Korrektion på <span class="mono">{formatOre(form.preview.differenceOre)}</span> dateret i dag, så Likvider bliver <span class="mono">{formatOre(form.preview.actualOre)}</span>. Den indtastede saldo gemmes i revisionssporet.</p>
            <form method="POST" action="?/book" class="confirmbox__actions">
              <input type="hidden" name="actual" value={formatOre(form.preview.actualOre, false)} />
              <a class="btn" href="/balance">Annullér</a>
              <button type="submit" class="btn btn--primary btn--std">Bogfør korrektion</button>
            </form>
          </div>
        {/if}
      </div>
    {:else}
      <form class="panel__body reconcile" method="POST" action="?/reconcile">
        {#if form?.error}<p class="error formerror">{form.error}</p>{/if}
        <div class="field">
          <label class="label" for="actual">Saldo ifølge banken</label>
          <input class="input input--num input--short" id="actual" name="actual" inputmode="decimal" placeholder="0,00" required />
        </div>
        <button type="submit" class="btn">Sammenlign</button>
      </form>
    {/if}
  </div>
</section>

<style>
  .prose { max-width: var(--layout-prose-max); margin: 0; }
  .kpis--1 { grid-template-columns: minmax(0, 1fr); }
  .reconcile { display: flex; align-items: flex-end; gap: var(--space-2); }
  .totals__row dt .hint { display: block; }
</style>
