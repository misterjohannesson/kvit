<script lang="ts">
  import CustomerFields from '$lib/components/CustomerFields.svelte';
  import { formatCvr } from '$lib/format';
  let { data, form } = $props();
</script>

<svelte:head><title>Kunder · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Salg</p>
    <h1>Kunder</h1>
  </div>
  <div class="pagehead__actions">
    <a class="btn" href="#ny-kunde">Ny kunde</a>
  </div>
</div>

<section>
  <div class="panel">
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Navn</th>
            <th scope="col">Adresse</th>
            <th scope="col">CVR</th>
            <th scope="col">E-mail</th>
            <th scope="col" class="num">Frist</th>
            <th scope="col" class="num">Fakturaer</th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#if data.customers.length === 0}<tr><td colspan="7" class="empty">Ingen kunder endnu. <a class="btn btn--sm" href="#ny-kunde">Ny kunde</a></td></tr>{/if}
          {#each data.customers as c (c.id)}
            <tr class="rowlink" onclick={() => (location.href = `/kunder/${c.id}`)}>
              <td>{c.name}</td>
              <td>{c.address}<span class="cell-sub">{c.zip} {c.city}{c.country !== 'DK' ? `, ${c.country}` : ''}</span></td>
              <td class="mono nowrap">{c.cvr ? formatCvr(c.cvr) : '—'}</td>
              <td>{c.email || '—'}</td>
              <td class="num">{c.paymentTermsDays ?? '—'}</td>
              <td class="num">{c.invoiceCount}</td>
              <td><div class="row-actions"><a class="btn btn--ghost btn--sm" href="/kunder/{c.id}" onclick={(e) => e.stopPropagation()}>Redigér</a></div></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section id="ny-kunde">
  <div class="section__head">
    <h2>Ny kunde</h2>
    <p>Kundens navn og adresse trykkes på fakturaen. Ændringer senere påvirker ikke allerede udstedte fakturaer.</p>
  </div>
  <form class="panel" method="POST" action="?/create">
    <div class="panel__body">
      {#if form?.error}<p class="error formerror">{form.error}</p>{/if}
      <CustomerFields values={form?.values ?? {}} defaultTermsDays={data.defaultTermsDays} />
    </div>
    <div class="panel__foot">
      <button type="submit" class="btn btn--primary btn--std">Opret kunde</button>
    </div>
  </form>
</section>

