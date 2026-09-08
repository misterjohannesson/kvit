<script lang="ts">
  import { formatDate, formatOre } from '$lib/format';
  let { data, form } = $props();
  const s = $derived(data.settings);
  const err = (k: string): string | undefined => form?.fields?.[k];
</script>

<svelte:head><title>Indstillinger · Kvit</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">System</p>
    <h1>Indstillinger</h1>
  </div>
</div>

{#if form?.error && !form?.fields}<p class="error">{form.error}</p>{/if}
{#if form?.saved}<p class="hint">Gemt.</p>{/if}

<form class="panel" method="POST" action="?/save">
  <div class="panel__body">
    <div class="form-grid">
      <fieldset class="field--span-12 first">
        <legend>Firmaoplysninger</legend>
        <div class="form-grid">
          <div class="field field--span-8">
            <label class="label" for="company_name">Firmanavn</label>
            <input class="input" id="company_name" name="company_name" value={s.company_name} required />
          </div>
          <div class="field field--span-4">
            <label class="label" for="company_cvr">CVR-nummer</label>
            <input class="input mono input--short" id="company_cvr" name="company_cvr" value={s.company_cvr} inputmode="numeric" placeholder="8 cifre" required />
          </div>
          <div class="field field--span-8">
            <label class="label" for="company_address">Adresse</label>
            <input class="input" id="company_address" name="company_address" value={s.company_address} required />
          </div>
          <div class="field field--span-2">
            <label class="label" for="company_zip">Postnr.</label>
            <input class="input mono input--short" id="company_zip" name="company_zip" value={s.company_zip} required />
          </div>
          <div class="field field--span-2">
            <label class="label" for="company_city">By</label>
            <input class="input" id="company_city" name="company_city" value={s.company_city} required />
          </div>
          <div class="field field--span-12">
            <label class="check"><input type="checkbox" name="vat_registered" checked={s.vat_registered === '1'} /> Momsregistreret</label>
          </div>
        </div>
      </fieldset>

      <fieldset class="field--span-12">
        <legend>Bank og betaling</legend>
        <div class="form-grid">
          <div class="field field--span-2">
            <label class="label" for="bank_reg">Reg.nr.</label>
            <input class="input mono input--short" id="bank_reg" name="bank_reg" value={s.bank_reg} inputmode="numeric" />
          </div>
          <div class="field field--span-4">
            <label class="label" for="bank_account">Kontonr.</label>
            <input class="input mono" id="bank_account" name="bank_account" value={s.bank_account} inputmode="numeric" />
          </div>
          <div class="field field--span-3">
            <label class="label" for="payment_terms_days">Betalingsfrist, dage</label>
            <input class="input input--num input--short" id="payment_terms_days" name="payment_terms_days" type="number" min="0" max="365" value={s.payment_terms_days} required />
            <span class="hint">Bruges til forfaldsdato på nye kladder.</span>
          </div>
        </div>
      </fieldset>

      <fieldset class="field--span-12">
        <legend>Åbningssaldo</legend>
        <div class="form-grid">
          <div class="field field--span-3 {err('opening_balance') ? 'field--error' : ''}">
            <label class="label" for="opening_balance">Banksaldo</label>
            <input class="input input--num input--short" id="opening_balance" name="opening_balance" value={formatOre(Number(s.opening_balance_ore) || 0, false)} inputmode="decimal" required />
            {#if err('opening_balance')}<span class="error">{err('opening_balance')}</span>{:else}<span class="hint">Saldoen ved dagens begyndelse; bevægelser på selve datoen tælles med. Cashflow og balance tæller herfra.</span>{/if}
          </div>
          <div class="field field--span-3 {err('opening_balance_date') ? 'field--error' : ''}">
            <label class="label" for="opening_balance_date">Pr. dato</label>
            <input class="input input--date" id="opening_balance_date" name="opening_balance_date" inputmode="numeric" value={formatDate(s.opening_balance_date)} placeholder="dd.mm.åååå" required />
            {#if err('opening_balance_date')}<span class="error">{err('opening_balance_date')}</span>{/if}
          </div>
        </div>
      </fieldset>

      <fieldset class="field--span-12">
        <legend>Nummerserie</legend>
        <div class="form-grid">
          <div class="field field--span-3">
            <label class="label" for="next_invoice_number">Næste fakturanummer</label>
            <input class="input input--num input--short" id="next_invoice_number" name="next_invoice_number" type="number" min={s.next_invoice_number} value={s.next_invoice_number} required />
            <span class="hint">Kan kun sættes op, og det er den eneste måde, serien kan få et hul. Ændringen logges i revisionssporet. Nummeret tildeles først, når en faktura udstedes.</span>
          </div>
        </div>
      </fieldset>
    </div>
  </div>
  <div class="panel__foot">
    <button type="submit" class="btn btn--primary btn--std">Gem indstillinger</button>
  </div>
</form>

<section>
  <div class="section__head">
    <h2>Kontoplan</h2>
    <p>
      Salgskonti bruges på fakturalinjer, omkostningskonti på udgifter. Grupper giver Resultat sine mellemsummer og
      vises i rækkefølge efter laveste kontonummer. En konto kan omdøbes, flyttes til en anden gruppe og arkiveres
      (skjules for nye bilag, historikken bliver), men aldrig slettes, mens den er i brug. Nummer og type er faste.
    </p>
  </div>
  <div class="panel">
    <div class="table-wrap">
      <table class="data data--dense">
        <thead>
          <tr>
            <th scope="col">Konto</th>
            <th scope="col">Type</th>
            <th scope="col">Navn</th>
            <th scope="col">Gruppe</th>
            <th scope="col">Status</th>
            <th scope="col" class="num">I brug</th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#each data.accounts as a (a.id)}
            <tr class={a.archived ? 'archived' : ''}>
              <td class="mono">{a.number}</td>
              <td>{a.type === 'revenue' ? 'Salg' : 'Omkostning'}</td>
              <td>
                <label class="label" for="acc-name-{a.id}" hidden>Navn</label>
                <input class="input input--cell" id="acc-name-{a.id}" name="name" value={a.name} form="acc-form-{a.id}" required />
              </td>
              <td>
                <label class="label" for="acc-group-{a.id}" hidden>Gruppe</label>
                <input class="input input--cell" id="acc-group-{a.id}" name="group" value={a.group} list="account-groups" form="acc-form-{a.id}" maxlength="60" />
              </td>
              <td>
                <label class="label" for="acc-archived-{a.id}" hidden>Status</label>
                <select class="select input--cell" id="acc-archived-{a.id}" name="archived" form="acc-form-{a.id}">
                  <option value="nej" selected={!a.archived}>Aktiv</option>
                  <option value="ja" selected={a.archived}>Arkiveret</option>
                </select>
              </td>
              <td class="num">{a.usage}</td>
              <td>
                <div class="row-actions">
                  <form method="POST" action="?/updateAccount" id="acc-form-{a.id}">
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" class="btn btn--ghost btn--sm">Gem</button>
                  </form>
                  {#if a.usage === 0}
                    <form method="POST" action="?/deleteAccount">
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" class="btn btn--ghost btn--sm btn--danger" onclick={(e) => { if (!confirm(`Slet konto ${a.number} ${a.name}?`)) e.preventDefault(); }}>Slet</button>
                    </form>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <datalist id="account-groups">
        {#each data.groups as g (g)}<option value={g}></option>{/each}
      </datalist>
    </div>
    <form method="POST" action="?/addAccount">
      <div class="panel__body">
        <fieldset>
          <legend>Ny konto</legend>
          <div class="form-grid">
            <div class="field field--span-2">
              <label class="label" for="new-number">Kontonr.</label>
              <input class="input input--num input--short mono" id="new-number" name="number" inputmode="numeric" placeholder="2700" required />
            </div>
            <div class="field field--span-4">
              <label class="label" for="new-name">Navn</label>
              <input class="input" id="new-name" name="name" required />
            </div>
            <div class="field field--span-3">
              <label class="label" for="new-group">Gruppe</label>
              <input class="input" id="new-group" name="group" list="account-groups" maxlength="60" placeholder="fx Administration" />
            </div>
            <div class="field field--span-3">
              <label class="label" for="new-type">Type</label>
              <select class="select input--short" id="new-type" name="type">
                <option value="cost">Omkostning</option>
                <option value="revenue">Salg</option>
              </select>
            </div>
          </div>
        </fieldset>
      </div>
      <div class="panel__foot">
        <button type="submit" class="btn">Tilføj konto</button>
      </div>
    </form>
  </div>
</section>

<section>
  <div class="section__head">
    <h2>Kontoplan som fil</h2>
    <p>
      Hent kontoplanen som CSV, ret den i et regneark og indlæs den igen. Kolonnerne er
      <span class="mono">kontonr;navn;type;gruppe;arkiveret</span> med type <span class="mono">salg</span> eller
      <span class="mono">omkostning</span> og arkiveret <span class="mono">ja</span>/<span class="mono">nej</span>.
      Kontonummeret er nøglen: kendte numre får nyt navn, gruppe og status, nye numre oprettes. Type kan ikke ændres.
      Indlæsningen sker samlet – er der én fejl, ændres intet.
    </p>
  </div>
  <div class="panel">
    {#if form?.imported}
      <div class="panel__body"><p class="hint">{form.imported}</p></div>
    {/if}
    <form method="POST" action="?/importAccounts" enctype="multipart/form-data">
      <div class="panel__body">
        <div class="form-grid">
          <div class="field field--span-6">
            <label class="label" for="kontoplan-file">Redigeret kontoplan (CSV)</label>
            <input class="input input--md input--file" id="kontoplan-file" name="file" type="file" accept=".csv,text/csv,text/plain" required />
          </div>
          <div class="field field--span-6">
            <span class="label">Konti, der ikke står i filen</span>
            <label class="check"><input type="checkbox" name="prune" /> Slet dem (kun konti uden bilag; konti i brug skal stå i filen, evt. som arkiveret)</label>
          </div>
        </div>
      </div>
      <div class="panel__foot">
        <a class="btn" href="/api/accounts/csv" download="kontoplan.csv">Hent kontoplan.csv</a>
        <button type="submit" class="btn btn--primary">Indlæs fil</button>
      </div>
    </form>
  </div>
</section>

<style>
  fieldset.first { border-top: 0; }
  tr.archived td { color: var(--text-secondary); }
  tr.archived td.mono { text-decoration: line-through; }
  .row-actions { display: flex; gap: var(--space-2); }
</style>
