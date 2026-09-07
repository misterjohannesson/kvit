<script lang="ts">
  import CustomerFields from '$lib/components/CustomerFields.svelte';
  import InvoiceTable from '$lib/components/InvoiceTable.svelte';
  let { data, form } = $props();
  const c = $derived(data.customer);
</script>

<svelte:head><title>{c.name} · Faktura</title></svelte:head>

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
    <span class="panel__meta">Oprettet {c.createdAt.slice(0, 10)}</span>
  </div>
  <div class="panel__body">
    <CustomerFields values={c} />
  </div>
  <div class="panel__foot">
    {#if data.invoices.length === 0}
      <button
        type="submit"
        class="btn btn--danger spacer"
        formaction="?/delete"
        formnovalidate
        onclick={(e) => {
          if (!confirm(`Slet kunden ${c.name}?`)) e.preventDefault();
        }}>Slet kunde</button>
    {:else}
      <span class="hint spacer">Kunden har fakturaer og kan ikke slettes.</span>
    {/if}
    <button type="submit" class="btn btn--primary">Gem</button>
  </div>
</form>

<section>
  <div class="section__head">
    <h2>Fakturaer</h2>
  </div>
  <div class="panel">
    <InvoiceTable rows={data.invoices} today={data.today} empty="Ingen fakturaer til denne kunde." />
  </div>
</section>
