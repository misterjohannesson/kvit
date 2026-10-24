<script lang="ts">
  import { formatOre } from '$lib/format';
  let {
    values = {},
    defaultTermsDays
  }: {
    values?: Partial<Record<'name' | 'address' | 'zip' | 'city' | 'country' | 'cvr' | 'email' | 'paymentTermsDays' | 'hourlyRate' | 'hourlyRateOre', string | number | null>>;
    /** Settings default shown when the customer has no terms of their own. */
    defaultTermsDays: number;
  } = $props();
  const v = (k: keyof typeof values, fallback = '') => (values[k] === null || values[k] === undefined ? fallback : String(values[k]));
  // A failed submit returns the typed text; a stored customer has øre.
  const rate = () => (values.hourlyRate !== undefined && values.hourlyRate !== null ? String(values.hourlyRate) : typeof values.hourlyRateOre === 'number' ? formatOre(values.hourlyRateOre, false) : '');
</script>

<div class="form-grid">
  <div class="field field--span-8">
    <label class="label" for="name">Navn</label>
    <input class="input" id="name" name="name" value={v('name')} required />
  </div>
  <div class="field field--span-4">
    <label class="label" for="cvr">CVR-nummer <span class="label__optional">(valgfri)</span></label>
    <input class="input mono input--short" id="cvr" name="cvr" value={v('cvr')} placeholder="8 cifre" inputmode="numeric" />
  </div>
  <div class="field field--span-8">
    <label class="label" for="address">Adresse</label>
    <input class="input" id="address" name="address" value={v('address')} required />
  </div>
  <div class="field field--span-4">
    <label class="label" for="country">Land</label>
    <input class="input mono input--short" id="country" name="country" value={v('country', 'DK')} maxlength="2" required />
  </div>
  <div class="field field--span-3">
    <label class="label" for="zip">Postnr.</label>
    <input class="input mono input--short" id="zip" name="zip" value={v('zip')} required />
  </div>
  <div class="field field--span-5">
    <label class="label" for="city">By</label>
    <input class="input" id="city" name="city" value={v('city')} required />
  </div>
  <div class="field field--span-4">
    <label class="label" for="email">E-mail <span class="label__optional">(valgfri)</span></label>
    <input class="input" id="email" name="email" type="email" value={v('email')} />
  </div>
  <div class="field field--span-3">
    <label class="label" for="paymentTermsDays">Betalingsfrist, dage <span class="label__optional">(valgfri)</span></label>
    <input class="input input--num input--short" id="paymentTermsDays" name="paymentTermsDays" type="number" min="0" max="365" value={v('paymentTermsDays')} placeholder={String(defaultTermsDays)} />
    <span class="hint">Tom = standarden fra Indstillinger (<span class="mono">{defaultTermsDays}</span> dage). Sætter forfaldsdatoen på nye fakturaer.</span>
  </div>
  <div class="field field--span-3">
    <label class="label" for="hourlyRate">Timepris ekskl. moms <span class="label__optional">(valgfri)</span></label>
    <input class="input input--num input--short" id="hourlyRate" name="hourlyRate" value={rate()} inputmode="decimal" placeholder="0,00" />
    <span class="hint">Bruges, når registreret tid lægges på en faktura. Kan rettes pr. linje på kladden.</span>
  </div>
</div>
