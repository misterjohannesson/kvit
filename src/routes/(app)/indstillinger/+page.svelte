<script lang="ts">
  let { data, form } = $props();
  const s = $derived(data.settings);
</script>

<svelte:head><title>Indstillinger · Faktura</title></svelte:head>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow">System</p>
    <h1>Indstillinger</h1>
  </div>
</div>

{#if form?.error}<p class="error">{form.error}</p>{/if}
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

<style>
  fieldset.first { border-top: 0; }
</style>
