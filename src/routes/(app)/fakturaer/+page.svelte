<script lang="ts">
  import InvoiceTable from '$lib/components/InvoiceTable.svelte';
  let { data, form } = $props();

  const filters: { key: string; label: string }[] = [
    { key: 'alle', label: 'Alle' },
    { key: 'kladder', label: 'Kladder' },
    { key: 'aabne', label: 'Åbne' },
    { key: 'forfaldne', label: 'Forfaldne' },
    { key: 'betalte', label: 'Betalte' },
    { key: 'krediterede', label: 'Krediterede' }
  ];
  const href = (status: string, year: number | undefined) =>
    `/fakturaer?status=${status}${year ? `&year=${year}` : ''}`;
</script>

<svelte:head><title>Fakturaer · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Salg</p>
    <h1>Fakturaer</h1>
  </div>
  <form class="pagehead__actions" method="POST" action="?/create">
    <label class="label" for="new-customer" hidden>Kunde</label>
    <select class="select" id="new-customer" name="customerId" required>
      <option value="">Vælg kunde…</option>
      {#each data.customers as c (c.id)}
        <option value={c.id}>{c.name}</option>
      {/each}
    </select>
    <button type="submit" class="btn" disabled={data.customers.length === 0}>Ny faktura</button>
  </form>
</div>

{#if form?.error}
  <p class="error">{form.error}</p>
{/if}
{#if data.customers.length === 0}
  <p class="hint">Opret først en <a href="/kunder">kunde</a> for at kunne lave en faktura.</p>
{/if}

<section>
  <div class="panel">
    <div class="toolbar">
      <div class="segment" role="group" aria-label="Filtrér status">
        {#each filters as f (f.key)}
          <a href={href(f.key, data.year)} aria-current={data.filter === f.key ? 'true' : undefined} class="segment__link">{f.label}</a>
        {/each}
      </div>
      <div class="segment" role="group" aria-label="År">
        <a href={href(data.filter, undefined)} aria-current={!data.year ? 'true' : undefined} class="segment__link">Alle år</a>
        {#each data.years as y (y)}
          <a href={href(data.filter, y)} aria-current={data.year === y ? 'true' : undefined} class="segment__link mono">{y}</a>
        {/each}
      </div>
      <div class="toolbar__spacer"></div>
      <span class="panel__meta">{data.rows.length} rækker</span>
    </div>
    <InvoiceTable rows={data.rows} today={data.today} footer="{data.rows.length} rækker" />
  </div>
</section>

<style>
  .segment__link {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
  .segment__link:hover { text-decoration: none; color: var(--text-primary); }
</style>
