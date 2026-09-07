<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatDate, formatOre, formatQuantity, lineTotalOre, parseKrToOre, parseQuantity, roundOre } from '$lib/format';

  type Line = { description: string; quantity: string; unit: string; unitPrice: string; accountId: number };
  type Customer = { id: number; name: string };
  type Account = { id: number; number: number; name: string };
  type Invoice = {
    id: number;
    customerId: number;
    issueDate: string;
    dueDate: string;
    paymentReference: string;
    vatExemptReason: string | null;
    lines: { description: string; quantity: number; unit: string; unitPriceOre: number; accountId: number }[];
  };

  let {
    invoice,
    customers,
    accounts,
    nextNumber,
    problems,
    error,
    fieldErrors = {}
  }: {
    invoice: Invoice;
    customers: Customer[];
    accounts: Account[];
    nextNumber: number;
    problems: string[];
    error?: string;
    fieldErrors?: Record<string, string>;
  } = $props();

  const toLine = (l: Invoice['lines'][number]): Line => ({
    description: l.description,
    quantity: formatQuantity(l.quantity),
    unit: l.unit,
    unitPrice: formatOre(l.unitPriceOre, false),
    accountId: l.accountId
  });
  // svelte-ignore state_referenced_locally
  const defaultAccountId = accounts[0]?.id ?? 1;

  // svelte-ignore state_referenced_locally
  let lines = $state<Line[]>(invoice.lines.length ? invoice.lines.map(toLine) : [{ description: '', quantity: '1,00', unit: 'time', unitPrice: '', accountId: defaultAccountId }]);
  // svelte-ignore state_referenced_locally
  let vatExempt = $state(invoice.vatExemptReason !== null);
  // svelte-ignore state_referenced_locally
  let vatExemptReason = $state(invoice.vatExemptReason ?? 'Omvendt betalingspligt, jf. momslovens § 46');
  let confirming = $state(false);
  let submitting = $state(false);

  function lineTotal(l: Line): number | null {
    try {
      return lineTotalOre(parseQuantity(l.quantity), parseKrToOre(l.unitPrice));
    } catch {
      return null;
    }
  }

  const totals = $derived.by(() => {
    const filled = lines.filter((l) => l.description.trim() || l.quantity.trim() || l.unitPrice.trim());
    const amounts = filled.map(lineTotal);
    const valid = filled.length > 0 && amounts.every((a) => a !== null) && filled.every((l) => l.description.trim() && l.unit.trim());
    const subtotal = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
    const vat = vatExempt ? 0 : roundOre((subtotal * 2500) / 10000);
    return { subtotal, vat, total: subtotal + vat, valid, count: filled.length };
  });

  const canIssue = $derived(totals.valid && problems.filter((p) => !p.startsWith('Fakturaen har ingen linjer')).length === 0);

  function addLine() {
    lines.push({ description: '', quantity: '1,00', unit: 'time', unitPrice: '', accountId: lines[lines.length - 1]?.accountId ?? defaultAccountId });
  }
  function removeLine(i: number) {
    lines.splice(i, 1);
    if (lines.length === 0) addLine();
  }
  const err = (k: string) => fieldErrors[k];
</script>

<div class="pagehead">
  <div>
    <p class="pagehead__eyebrow"><a href="/fakturaer">Fakturaer</a> · Kladde</p>
    <h1>Ny faktura</h1>
  </div>
</div>

<form
  method="POST"
  action="?/save"
  class="layout-8-4 layout-8-4--lines"
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      submitting = false;
      confirming = false;
      await update({ reset: false });
    };
  }}
>
  <input type="hidden" name="lines" value={JSON.stringify(lines)} />
  <!-- The number shown in the confirm step; the server refuses to issue if the series has moved. -->
  <input type="hidden" name="expectedNumber" value={nextNumber} />

  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Fakturaoplysninger</h3>
      <span class="panel__meta">Kladde · intet nummer endnu</span>
    </div>

    <div class="panel__body">
      {#if error && Object.keys(fieldErrors).length === 0}
        <p class="error formerror">{error}</p>
      {/if}
      <div class="form-grid">
        <div class="field field--span-6">
          <label class="label" for="customerId">Kunde</label>
          <select class="select" id="customerId" name="customerId" required>
            {#each customers as c (c.id)}
              <option value={c.id} selected={c.id === invoice.customerId}>{c.name}</option>
            {/each}
          </select>
        </div>
        <div class="field field--span-3 {err('issueDate') ? 'field--error' : ''}">
          <label class="label" for="issueDate">Fakturadato</label>
          <input class="input input--date" id="issueDate" name="issueDate" inputmode="numeric" value={formatDate(invoice.issueDate)} placeholder="dd.mm.åååå" required />
          {#if err('issueDate')}<span class="error">{err('issueDate')}</span>{/if}
        </div>
        <div class="field field--span-3 {err('dueDate') ? 'field--error' : ''}">
          <label class="label" for="dueDate">Forfaldsdato</label>
          <input class="input input--date" id="dueDate" name="dueDate" inputmode="numeric" value={formatDate(invoice.dueDate)} placeholder="dd.mm.åååå" required />
          {#if err('dueDate')}<span class="error">{err('dueDate')}</span>{/if}
        </div>

        <div class="field field--span-12">
          <label class="label" for="paymentReference">Betalingsreference</label>
          <input class="input input--wide mono" id="paymentReference" name="paymentReference" value={invoice.paymentReference} placeholder="Reg. 1234 Konto 1234567890" required />
          <span class="hint">Bankoplysninger, som trykkes på fakturaen.</span>
        </div>

        <fieldset class="field--span-12">
          <legend>Fakturalinjer</legend>
          {#if err('lines')}<p class="error formerror">{err('lines')}</p>{/if}
          <div class="table-wrap">
            <table class="data data--dense lines">
              <thead>
                <tr>
                  <th scope="col">Beskrivelse</th>
                  <th scope="col" class="num">Antal</th>
                  <th scope="col">Enhed</th>
                  <th scope="col" class="num">Pris ekskl. moms</th>
                  <th scope="col" class="num">Beløb</th>
                  <th scope="col">Konto</th>
                  <th scope="col" class="col-actions"><span hidden>Fjern</span></th>
                </tr>
              </thead>
              <tbody>
                {#each lines as line, i (i)}
                  {@const t = lineTotal(line)}
                  <tr>
                    <td><input class="input input--cell" aria-label="Beskrivelse, linje {i + 1}" bind:value={line.description} placeholder="Ydelse" /></td>
                    <td><input class="input input--cell input--num input--xs" aria-label="Antal, linje {i + 1}" bind:value={line.quantity} inputmode="decimal" /></td>
                    <td><input class="input input--cell input--xs" aria-label="Enhed, linje {i + 1}" bind:value={line.unit} placeholder="time" /></td>
                    <td><input class="input input--cell input--num input--short" aria-label="Pris, linje {i + 1}" bind:value={line.unitPrice} inputmode="decimal" placeholder="0,00" /></td>
                    <td class="num {t !== null && t < 0 ? 'num--neg' : ''}">{t === null ? '—' : formatOre(t, false)}</td>
                    <td>
                      <select class="select input--cell input--account" aria-label="Konto, linje {i + 1}" bind:value={line.accountId}>
                        {#each accounts as a (a.id)}<option value={a.id}>{a.number} {a.name}</option>{/each}
                      </select>
                    </td>
                    <td><div class="row-actions"><button type="button" class="btn btn--ghost btn--sm" onclick={() => removeLine(i)}>Fjern</button></div></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="addline">
            <button type="button" class="btn btn--sm" onclick={addLine}>Tilføj linje</button>
          </div>
        </fieldset>

        <fieldset class="field--span-12">
          <legend>Moms</legend>
          <div class="form-grid">
            <div class="field field--span-12">
              <label class="check"><input type="checkbox" name="vatExempt" bind:checked={vatExempt} /> Momsfri (fx omvendt betalingspligt eller eksport)</label>
            </div>
            {#if vatExempt}
              <div class="field field--span-12 {err('vatExemptReason') ? 'field--error' : ''}">
                <label class="label" for="vatExemptReason">Årsag til momsfritagelse</label>
                <input class="input input--wide" id="vatExemptReason" name="vatExemptReason" bind:value={vatExemptReason} required />
                {#if err('vatExemptReason')}
                  <span class="error">{err('vatExemptReason')}</span>
                {:else}
                  <span class="hint">Teksten trykkes på fakturaen, fx "Omvendt betalingspligt, jf. momslovens § 46".</span>
                {/if}
              </div>
            {/if}
          </div>
        </fieldset>
      </div>
    </div>

    <div class="panel__foot">
      <button
        type="submit"
        class="btn btn--danger spacer"
        formaction="?/delete"
        formnovalidate
        onclick={(e) => {
          if (!confirm('Slet kladden? Den har intet nummer og efterlader intet spor i nummerserien.')) e.preventDefault();
        }}>Slet kladde</button>
      <button type="submit" class="btn" disabled={submitting}>Gem kladde</button>
      {#if !confirming}
        <button type="button" class="btn btn--primary" disabled={!canIssue || submitting} onclick={() => (confirming = true)}>Udsted</button>
      {/if}
    </div>
  </div>

  <div class="panel">
    <div class="panel__head">
      <h3 class="panel__title">Opsummering</h3>
      <span class="panel__meta">{totals.count} linjer</span>
    </div>
    <div class="panel__body">
      <dl class="totals">
        <div class="totals__row"><dt>Subtotal</dt><dd>{formatOre(totals.subtotal, false)}</dd></div>
        <div class="totals__row"><dt>Moms {vatExempt ? '0 %' : '25 %'}</dt><dd>{formatOre(totals.vat, false)}</dd></div>
        <div class="totals__row totals__row--sum"><dt>I alt</dt><dd>{formatOre(totals.total, false)}</dd></div>
      </dl>

      {#if confirming}
        <div class="confirmbox" role="alertdialog" aria-labelledby="confirm-title">
          <p class="confirmbox__title" id="confirm-title">Udsted faktura?</p>
          <p class="hint">Fakturaen får nummer <span class="mono">{nextNumber}</span> og kan herefter kun annulleres med en kreditnota. Kladden gemmes først, og PDF'en arkiveres som det juridiske dokument.</p>
          <div class="confirmbox__actions">
            <button type="button" class="btn" onclick={() => (confirming = false)}>Annullér</button>
            <button type="submit" class="btn btn--primary" formaction="?/issue" disabled={submitting}>Udsted nr. {nextNumber}</button>
          </div>
        </div>
      {:else}
        <p class="hint summaryhint">
          Ved udstedelse tildeles nummer <span class="mono">{nextNumber}</span>. Herefter kan fakturaen kun annulleres med en kreditnota.
        </p>
        {#if problems.length > 0 || !totals.valid}
          <ul class="problems">
            {#if !totals.valid}<li class="error">Udfyld mindst én linje med beskrivelse, antal, enhed og pris.</li>{/if}
            {#each problems.filter((p) => !p.startsWith('Fakturaen har ingen linjer')) as p (p)}
              <li class="error">{p}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
</form>

<style>
  .input--cell { height: var(--control-height-sm); padding: 0 var(--space-2); }
  /* fixed widths so the auto-layout table cannot squeeze the numeric inputs at 1152px */
  .input--cell.input--xs { width: var(--field-width-xs); min-width: var(--field-width-xs); }
  .input--cell.input--short { width: var(--field-width-sm); min-width: var(--field-width-sm); }
  .input--account { width: var(--field-width-md); min-width: var(--field-width-md); max-width: var(--field-width-md); }
  table.lines td:first-child { width: 100%; }
  table.lines th, table.lines td { padding: var(--space-1) var(--space-2); }
  .addline { margin-top: var(--space-3); }
  .summaryhint { margin: var(--space-4) 0 0; }
  .problems { margin: var(--space-3) 0 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-1); }
</style>
