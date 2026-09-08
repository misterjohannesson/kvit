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
    <p>Salgskonti bruges på fakturalinjer, omkostningskonti på udgifter. Konti kan tilføjes og omdøbes, men aldrig slettes, mens de er i brug.</p>
  </div>
  <div class="panel">
    <div class="table-wrap">
      <table class="data data--dense">
        <thead>
          <tr>
            <th scope="col">Konto</th>
            <th scope="col">Type</th>
            <th scope="col">Navn</th>
            <th scope="col" class="num">I brug</th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#each data.accounts as a (a.id)}
            <tr>
              <td class="mono">{a.number}</td>
              <td>{a.type === 'revenue' ? 'Salg' : 'Omkostning'}</td>
              <td>
                <form method="POST" action="?/renameAccount" class="inline">
                  <input type="hidden" name="id" value={a.id} />
                  <label class="label" for="acc-{a.id}" hidden>Navn</label>
                  <input class="input input--cell" id="acc-{a.id}" name="name" value={a.name} required />
                  <button type="submit" class="btn btn--ghost btn--sm">Omdøb</button>
                </form>
              </td>
              <td class="num">{a.usage}</td>
              <td>
                <div class="row-actions">
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
            <div class="field field--span-6">
              <label class="label" for="new-name">Navn</label>
              <input class="input" id="new-name" name="name" required />
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

<style>
  fieldset.first { border-top: 0; }
  .inline { display: flex; align-items: center; gap: var(--space-2); }
</style>
