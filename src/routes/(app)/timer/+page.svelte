<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { formatDate, formatOre, formatQuantity, minutesToHours } from '$lib/format';
  import InfoTip from '$lib/components/InfoTip.svelte';
  let { data, form } = $props();

  const STATUS: Record<string, { label: string; cls: string }> = {
    unbilled: { label: 'Ikke faktureret', cls: 'badge--aaben' },
    draft: { label: 'På kladde', cls: 'badge--kladde' },
    billed: { label: 'Faktureret', cls: 'badge--betalt' },
    not_billable: { label: 'Ikke fakturerbar', cls: 'badge--krediteret' }
  };
  const FILTERS = [
    { value: null, label: 'Alle' },
    { value: 'unbilled', label: 'Ikke faktureret' },
    { value: 'draft', label: 'På kladde' },
    { value: 'billed', label: 'Faktureret' },
    { value: 'not_billable', label: 'Ikke fakturerbar' }
  ];

  // svelte-ignore state_referenced_locally
  let customerId = $state(String(data.filter.customerId ?? data.customers[0]?.id ?? ''));
  // svelte-ignore state_referenced_locally
  let date = $state(data.today);
  let hours = $state('');
  let description = $state('');
  let billable = $state(true);
  let editing = $state<number | null>(null);
  let saving = $state(false);

  const createError = $derived(form && !form.entryId && form.error ? form : null);
  const rowError = (id: number) => (form?.entryId === id ? form.error : null);
  const totalMinutes = $derived(data.rows.reduce((s, r) => s + r.minutes, 0));

  function filterHref(status: string | null, kunde: number | null): string {
    const q = new URLSearchParams();
    if (kunde) q.set('kunde', String(kunde));
    if (status) q.set('status', status);
    const s = q.toString();
    return s ? `/timer?${s}` : '/timer';
  }
</script>

<svelte:head><title>Timer · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">Salg</p>
    <h1>Timer</h1>
  </div>
</div>

<form
  class="panel"
  method="POST"
  action="?/create"
  use:enhance={() => {
    saving = true;
    return async ({ result, update }) => {
      saving = false;
      if (result.type === 'success') {
        hours = '';
        description = '';
      }
      await update({ reset: false });
    };
  }}
>
  <div class="panel__head">
    <h3 class="panel__title">Registrér tid</h3>
    <span class="panel__meta">Timer skrives som 1,5 eller 1:30</span>
  </div>
  <div class="panel__body">
    {#if createError}<p class="error formerror">{createError.error}</p>{/if}
    {#if data.customers.length === 0}
      <p class="hint">Opret en kunde først. <a class="btn btn--sm" href="/kunder#ny-kunde">Ny kunde</a></p>
    {:else}
      <div class="form-grid">
        <div class="field field--span-4">
          <label class="label" for="t-customer">Kunde</label>
          <select class="select" id="t-customer" name="customerId" bind:value={customerId} required>
            {#each data.customers as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
          </select>
        </div>
        <div class="field field--span-3 {createError?.fields?.date ? 'field--error' : ''}">
          <label class="label" for="t-date">Dato</label>
          <input class="input input--date" id="t-date" name="date" type="date" bind:value={date} required />
        </div>
        <div class="field field--span-2 {createError?.fields?.hours ? 'field--error' : ''}">
          <label class="label" for="t-hours">Timer</label>
          <input class="input input--num input--xs" id="t-hours" name="hours" bind:value={hours} inputmode="decimal" placeholder="1,5" required />
        </div>
        <div class="field field--span-3">
          <span class="label">Fakturering</span>
          <label class="check"><input type="checkbox" name="billable" bind:checked={billable} /> Fakturerbar</label>
        </div>
        <div class="field field--span-12">
          <label class="label" for="t-desc">Beskrivelse</label>
          <input class="input input--wide" id="t-desc" name="description" bind:value={description} placeholder="Hvad blev der lavet" required />
        </div>
      </div>
    {/if}
  </div>
  <div class="panel__foot">
    <button type="submit" class="btn btn--primary btn--std" disabled={saving || data.customers.length === 0}>Registrér</button>
  </div>
</form>

<section>
  <div class="section__head">
    <h2>
      Klar til fakturering
      <InfoTip label="Om Fakturér">»Fakturér« laver en kladde med alle kundens ufakturerede timer, én linje pr. registrering. Afrunding, timepris og overskrifter klarer du på kladden.</InfoTip>
    </h2>
    <p>Fakturerbar tid, der ikke er lagt på en faktura endnu.</p>
  </div>
  <div class="panel">
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Kunde</th>
            <th scope="col">Periode</th>
            <th scope="col" class="num">Registreringer</th>
            <th scope="col" class="num">Timer</th>
            <th scope="col" class="num">Timepris</th>
            <th scope="col" class="num">Værdi</th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#if data.unbilled.length === 0}<tr><td colspan="7" class="empty">Ingen ufaktureret tid.</td></tr>{/if}
          {#each data.unbilled as u (u.customerId)}
            <tr>
              <td><a href="/kunder/{u.customerId}">{u.customerName}</a></td>
              <td class="mono nowrap">{formatDate(u.firstDate)}{u.lastDate !== u.firstDate ? ` – ${formatDate(u.lastDate)}` : ''}</td>
              <td class="num">{u.entries}</td>
              <td class="num">{formatQuantity(u.hours)}</td>
              <td class="num">{u.hourlyRateOre === null ? '—' : formatOre(u.hourlyRateOre, false)}</td>
              <td class="num">{u.valueOre === null ? '—' : formatOre(u.valueOre, false)}</td>
              <td>
                <form method="POST" action="?/bill" class="row-actions">
                  <input type="hidden" name="customerId" value={u.customerId} />
                  <button type="submit" class="btn btn--sm">Fakturér</button>
                </form>
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
    <h2>Registreringer</h2>
  </div>
  <div class="panel">
    <div class="toolbar">
      <div class="segment" role="group" aria-label="Status">
        {#each FILTERS as f (f.label)}
          <a href={filterHref(f.value, data.filter.customerId)} aria-current={data.filter.status === f.value ? 'true' : undefined}>{f.label}</a>
        {/each}
      </div>
      <label class="label" for="f-kunde" hidden>Kunde</label>
      <select class="select input--md" id="f-kunde" value={String(data.filter.customerId ?? '')} onchange={(e) => goto(filterHref(data.filter.status, Number(e.currentTarget.value) || null))}>
        <option value="">Alle kunder</option>
        {#each data.customers as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
      </select>
      <div class="toolbar__spacer"></div>
      <span class="panel__meta">{data.rows.length} registreringer · <span class="mono">{formatQuantity(minutesToHours(totalMinutes))}</span> timer</span>
    </div>
    <div class="table-wrap">
      <table class="data {data.dense ? 'data--dense' : ''}">
        <thead>
          <tr>
            <th scope="col">Dato</th>
            <th scope="col">Kunde</th>
            <th scope="col">Beskrivelse</th>
            <th scope="col" class="num">Timer</th>
            <th scope="col">Status</th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#if data.rows.length === 0}<tr><td colspan="6" class="empty">Ingen registreringer{data.filter.status || data.filter.customerId ? ' med dette filter' : ' endnu'}.</td></tr>{/if}
          {#each data.rows as r (r.id)}
            {@const locked = r.invoiceId !== null}
            {#if editing === r.id && !locked}
              <tr>
                <td><input form="edit-{r.id}" class="input input--cell input--date" name="date" type="date" value={r.date} aria-label="Dato" required /></td>
                <td>
                  <select form="edit-{r.id}" class="select input--cell" name="customerId" aria-label="Kunde">
                    {#each data.customers as c (c.id)}<option value={String(c.id)} selected={c.id === r.customerId}>{c.name}</option>{/each}
                  </select>
                </td>
                <td><input form="edit-{r.id}" class="input input--cell" name="description" value={r.description} aria-label="Beskrivelse" required /></td>
                <td><input form="edit-{r.id}" class="input input--cell input--num input--xs" name="hours" value={formatQuantity(r.hours)} inputmode="decimal" aria-label="Timer" required /></td>
                <td><label class="check"><input form="edit-{r.id}" type="checkbox" name="billable" checked={r.billable} /> Fakturerbar</label></td>
                <td>
                  <form id="edit-{r.id}" method="POST" action="?/update" class="row-actions" use:enhance={() => async ({ result, update }) => { if (result.type === 'success') editing = null; await update({ reset: false }); }}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="button" class="btn btn--ghost btn--sm" onclick={() => (editing = null)}>Annullér</button>
                    <button type="submit" class="btn btn--primary btn--sm">Gem</button>
                  </form>
                </td>
              </tr>
            {:else}
              <tr>
                <td class="mono nowrap">{formatDate(r.date)}</td>
                <td>{r.customerName}</td>
                <td class="wrap">
                  {r.description}
                  {#if r.invoiceId !== null && r.invoicedDescription && r.invoicedDescription !== r.description}<span class="cell-sub">På fakturaen: {r.invoicedDescription}</span>{/if}
                  {#if rowError(r.id)}<span class="error">{rowError(r.id)}</span>{/if}
                </td>
                <td class="num">
                  {formatQuantity(r.hours)}
                  {#if r.invoicedHours !== null && r.invoicedHours !== r.hours}<span class="cell-sub">fakt. {formatQuantity(r.invoicedHours)}</span>{/if}
                </td>
                <td class="nowrap">
                  <span class="badge {STATUS[r.status].cls}">{STATUS[r.status].label}</span>
                  {#if r.invoiceId !== null}
                    <a class="cell-sub" href="/fakturaer/{r.invoiceId}">{r.invoiceNumber ? `Faktura ${r.invoiceNumber}${r.invoiceStatus === 'credited' ? ' (krediteret)' : ''}` : 'Åbn kladde'}</a>
                  {/if}
                </td>
                <td>
                  {#if !locked}
                    <div class="row-actions">
                      <form method="POST" action="?/billable" use:enhance>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="billable" value={r.billable ? 'false' : 'true'} />
                        <button type="submit" class="btn btn--ghost btn--sm">{r.billable ? 'Ikke fakturerbar' : 'Fakturerbar'}</button>
                      </form>
                      <button type="button" class="btn btn--ghost btn--sm" onclick={() => (editing = r.id)}>Redigér</button>
                      <form
                        method="POST"
                        action="?/delete"
                        use:enhance={({ cancel }) => {
                          if (!confirm('Slet registreringen?')) cancel();
                        }}
                      >
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" class="btn btn--ghost btn--sm">Slet</button>
                      </form>
                    </div>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>
