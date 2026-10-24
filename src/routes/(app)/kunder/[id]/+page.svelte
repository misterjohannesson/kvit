<script lang="ts">
  import CustomerFields from '$lib/components/CustomerFields.svelte';
  import InvoiceTable from '$lib/components/InvoiceTable.svelte';
  import { formatDate, formatOre, formatQuantity } from '$lib/format';
  let { data, form } = $props();
  const c = $derived(data.customer);
</script>

<svelte:head><title>{c.name} · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow"><a href="/kunder">Kunder</a></p>
    <h1>{c.name}</h1>
  </div>
</div>

{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="hint">Gemt.</p>{/if}

<form class="panel" method="POST" action="?/save">
  <div class="panel__head">
    <h3 class="panel__title">Kundeoplysninger</h3>
    <span class="panel__meta">Oprettet {formatDate(c.createdAt.slice(0, 10))}</span>
  </div>
  <div class="panel__body">
    <CustomerFields values={c} defaultTermsDays={data.defaultTermsDays} />
  </div>
  <div class="panel__foot">
    {#if data.invoices.length === 0 && data.timeCount === 0}
      <button
        type="submit"
        class="btn btn--danger spacer"
        formaction="?/delete"
        formnovalidate
        onclick={(e) => {
          if (!confirm(`Slet kunden ${c.name}?`)) e.preventDefault();
        }}>Slet kunde</button>
    {:else}
      <span class="hint spacer">Kunden har {data.invoices.length ? 'fakturaer' : 'registreret tid'} og kan ikke slettes.</span>
    {/if}
    <button type="submit" class="btn btn--primary btn--std">Gem</button>
  </div>
</form>

<section>
  <div class="section__head">
    <h2>Timer</h2>
    <p><a href="/timer?kunde={c.id}">Alle registreringer for {c.name}</a></p>
  </div>
  <div class="panel">
    <div class="toolbar">
      {#if data.unbilled}
        <span><span class="mono">{formatQuantity(data.unbilled.hours)}</span> timer ikke faktureret ({data.unbilled.entries} registreringer){#if data.unbilled.valueOre !== null} · <span class="mono">{formatOre(data.unbilled.valueOre)}</span> til timepris{/if}</span>
        <div class="toolbar__spacer"></div>
        <form method="POST" action="?/bill"><button type="submit" class="btn btn--primary btn--sm">Fakturér timer</button></form>
      {:else}
        <span class="hint">Ingen ufaktureret tid.</span>
        <div class="toolbar__spacer"></div>
        <a class="btn btn--sm" href="/timer?kunde={c.id}">Registrér tid</a>
      {/if}
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Dato</th>
            <th scope="col">Beskrivelse</th>
            <th scope="col" class="num">Timer</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {#if data.time.length === 0}<tr><td colspan="4" class="empty">Ingen registreret tid.</td></tr>{/if}
          {#each data.time as r (r.id)}
            <tr>
              <td class="mono nowrap">{formatDate(r.date)}</td>
              <td class="wrap">{r.description}</td>
              <td class="num">{formatQuantity(r.hours)}{#if r.invoicedHours !== null && r.invoicedHours !== r.hours}<span class="cell-sub">fakt. {formatQuantity(r.invoicedHours)}</span>{/if}</td>
              <td class="nowrap">
                {#if r.status === 'billed'}
                  <a href="/fakturaer/{r.invoiceId}">Faktura <span class="mono">{r.invoiceNumber}</span></a>{r.invoiceStatus === 'credited' ? ' (krediteret)' : ''}
                {:else if r.status === 'draft'}
                  <a href="/fakturaer/{r.invoiceId}">På kladde</a>
                {:else}
                  {r.status === 'unbilled' ? 'Ikke faktureret' : 'Ikke fakturerbar'}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section>
  <div class="section__head">
    <h2>Fakturaer</h2>
  </div>
  <div class="panel">
    <InvoiceTable rows={data.invoices} today={data.today} dense={data.dense} empty="Ingen fakturaer til denne kunde." emptyAction={{ href: '/fakturaer', label: 'Ny faktura' }} />
  </div>
</section>
