<script lang="ts">
  import { enhance } from '$app/forms';
  import { addDays, formatOre, formatQuantity, lineTotalOre, parseKrToOre, parseQuantity, roundOre } from '$lib/format';
  import TimeLines from './TimeLines.svelte';
  import InfoTip from './InfoTip.svelte';
  import { serialize, timeProblems, timeSubtotal, type EditorTimeRow } from '$lib/time-rows';

  type Line = { description: string; quantity: string; unit: string; unitPrice: string; accountId: number | undefined };
  type Customer = { id: number; name: string; paymentTermsDays: number | null; hourlyRateOre: number | null };
  type Account = { id: number; number: number; name: string; archived?: boolean };
  type Invoice = {
    id: number;
    customerId: number;
    issueDate: string;
    dueDate: string;
    paymentReference: string;
    vatExemptReason: string | null;
    lines: { description: string; quantity: number; unit: string; unitPriceOre: number; accountId: number; kind: string }[];
  };

  let {
    invoice,
    customers,
    accounts,
    defaultTermsDays,
    nextNumber,
    problems,
    error,
    fieldErrors = {},
    time,
    availableTime
  }: {
    /** The stored time section (server figures). */
    time: { rows: ServerTimeRow[] };
    availableTime: { id: number; date: string; minutes: number; description: string }[];
    invoice: Invoice;
    customers: Customer[];
    accounts: Account[];
    /** Settings default, used when the customer has no terms of their own. */
    defaultTermsDays: number;
    nextNumber: number;
    problems: string[];
    error?: string;
    fieldErrors?: Record<string, string>;
  } = $props();

  type ServerTimeRow =
    | { type: 'group'; description: string }
    | { type: 'entry'; entryId: number; indent: boolean; date: string; minutes: number; description: string; invoicedHours: number; invoicedDescription: string; rateOre: number | null; standardRateOre: number | null };

  // svelte-ignore state_referenced_locally
  let timeRows = $state<EditorTimeRow[]>(
    time.rows.map((r, i): EditorTimeRow =>
      r.type === 'group'
        ? { type: 'group', key: `s${i}`, description: r.description }
        : {
            type: 'entry',
            key: `s${i}`,
            entryId: r.entryId,
            indent: r.indent,
            date: r.date,
            minutes: r.minutes,
            loggedDescription: r.description,
            invoicedHours: formatQuantity(r.invoicedHours),
            invoicedDescription: r.invoicedDescription,
            rate: r.rateOre === null ? '' : formatOre(r.rateOre, false),
            standardRateOre: r.standardRateOre
          }
    )
  );
  const hasTime = $derived(timeRows.some((r) => r.type === 'entry'));

  const toLine = (l: Invoice['lines'][number]): Line => ({
    description: l.description,
    quantity: formatQuantity(l.quantity),
    unit: l.unit,
    unitPrice: formatOre(l.unitPriceOre, false),
    accountId: l.accountId
  });
  // svelte-ignore state_referenced_locally
  const active = accounts.filter((a) => !a.archived);
  // svelte-ignore state_referenced_locally
  const defaultAccountId = (active.find((a) => a.number === 1000) ?? active[0] ?? accounts[0])?.id;

  // svelte-ignore state_referenced_locally
  const manualLines = invoice.lines.filter((l) => l.kind === 'manual');
  // svelte-ignore state_referenced_locally
  let lines = $state<Line[]>(manualLines.length ? manualLines.map(toLine) : time.rows.length ? [] : [{ description: '', quantity: '1,00', unit: 'time', unitPrice: '', accountId: defaultAccountId }]);
  // svelte-ignore state_referenced_locally
  let vatExempt = $state(invoice.vatExemptReason !== null);
  // svelte-ignore state_referenced_locally
  let vatExemptReason = $state(invoice.vatExemptReason ?? 'Omvendt betalingspligt, jf. momslovens § 46');
  // svelte-ignore state_referenced_locally
  let customerId = $state(invoice.customerId);
  // svelte-ignore state_referenced_locally
  let issueDate = $state(invoice.issueDate);
  // svelte-ignore state_referenced_locally
  let dueDate = $state(invoice.dueDate);
  let confirming = $state(false);
  let submitting = $state(false);

  /** The customer's own terms, else the settings default. */
  const terms = $derived.by(() => {
    const c = customers.find((x) => x.id === customerId);
    return c?.paymentTermsDays !== null && c?.paymentTermsDays !== undefined
      ? { days: c.paymentTermsDays, source: 'kundens aftale' }
      : { days: defaultTermsDays, source: 'standard fra Indstillinger' };
  });

  /** Due date follows the invoice date (and the customer's terms); editing the due date changes nothing else. */
  function recalcDue() {
    if (/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) dueDate = addDays(issueDate, terms.days);
  }

  function lineTotal(l: Line): number | null {
    try {
      return lineTotalOre(parseQuantity(l.quantity), parseKrToOre(l.unitPrice));
    } catch {
      return null;
    }
  }

  const timeIssues = $derived(timeProblems(timeRows));
  const timeLineCount = $derived(timeRows.filter((r) => r.type === 'group' || !r.indent).length);

  const totals = $derived.by(() => {
    const filled = lines.filter((l) => l.description.trim() || l.quantity.trim() || l.unitPrice.trim());
    const amounts = filled.map(lineTotal);
    const timeTotal = timeSubtotal(timeRows);
    const manualValid = amounts.every((a) => a !== null) && filled.every((l) => l.description.trim() && l.unit.trim());
    const valid = filled.length + timeLineCount > 0 && manualValid && timeIssues.length === 0;
    const subtotal = amounts.reduce<number>((s, a) => s + (a ?? 0), 0) + (timeTotal ?? 0);
    const vat = vatExempt ? 0 : roundOre((subtotal * 2500) / 10000);
    return { subtotal, vat, total: subtotal + vat, valid, manualValid, count: filled.length + timeLineCount };
  });

  // Time problems from the last save are replaced by the live ones from the editor.
  const serverProblems = $derived(problems.filter((p) => !p.startsWith('Fakturaen har ingen linjer') && !/timepris|Overskriften/.test(p)));
  const canIssue = $derived(totals.valid && serverProblems.length === 0);

  function addLine() {
    lines.push({ description: '', quantity: '1,00', unit: 'time', unitPrice: '', accountId: lines[lines.length - 1]?.accountId ?? defaultAccountId });
  }
  function removeLine(i: number) {
    lines.splice(i, 1);
    if (lines.length === 0 && timeRows.length === 0) addLine();
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
  <input type="hidden" name="time" value={serialize(timeRows)} />
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
          <label class="label" for="customerId">
            Kunde
            {#if hasTime}<InfoTip label="Hvorfor kan kunden ikke skiftes?">Kladden har kundens timer. Fjern dem fra kladden, hvis du vil skifte kunde.</InfoTip>{/if}
          </label>
          <select class="select" id="customerId" name="customerId" bind:value={customerId} onchange={recalcDue} required disabled={hasTime}>
            {#each customers as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
          {#if hasTime}<input type="hidden" name="customerId" value={customerId} />{/if}
        </div>
        <div class="field field--span-3 {err('issueDate') ? 'field--error' : ''}">
          <label class="label" for="issueDate">Fakturadato</label>
          <input class="input input--date" id="issueDate" name="issueDate" type="date" bind:value={issueDate} oninput={recalcDue} required />
          {#if err('issueDate')}<span class="error">{err('issueDate')}</span>{/if}
        </div>
        <div class="field field--span-3 {err('dueDate') ? 'field--error' : ''}">
          <label class="label" for="dueDate">
            Forfaldsdato
            <InfoTip label="Om forfaldsdatoen">Netto <span class="mono">{terms.days}</span> dage ({terms.source}). Datoen følger fakturadatoen, men du kan rette den frit, hvis I har aftalt noget andet.</InfoTip>
          </label>
          <input class="input input--date" id="dueDate" name="dueDate" type="date" bind:value={dueDate} required />
          {#if err('dueDate')}<span class="error">{err('dueDate')}</span>{/if}
        </div>

        <div class="field field--span-12">
          <label class="label" for="paymentReference">
            Betalingsreference <span class="label__optional">(valgfri)</span>
            <InfoTip label="Om betalingsreferencen">Den tekst, kunden skriver på bankoverførslen. Lader du feltet stå tomt, bliver det til »Faktura <span class="mono">{nextNumber}</span>«, når fakturaen udstedes. Reg.- og kontonummer kommer fra Indstillinger.</InfoTip>
          </label>
          <input class="input input--wide" id="paymentReference" name="paymentReference" value={invoice.paymentReference} placeholder="Faktura {nextNumber}" />
        </div>

        <TimeLines bind:rows={timeRows} available={availableTime} customerRateOre={customers.find((c) => c.id === customerId)?.hourlyRateOre ?? null} error={err('time')} />

        <fieldset class="field--span-12">
          <legend>{hasTime ? 'Øvrige linjer' : 'Fakturalinjer'}</legend>
          {#if err('lines')}<p class="error formerror">{err('lines')}</p>{/if}
          <div class="table-wrap">
            <table class="data data--dense lines">
              <thead>
                <tr>
                  <th scope="col">Beskrivelse og konto</th>
                  <th scope="col" class="num">Antal</th>
                  <th scope="col">Enhed</th>
                  <th scope="col" class="num">Pris ekskl. moms</th>
                  <th scope="col" class="num">Beløb</th>
                  <th scope="col" class="col-actions"><span hidden>Fjern</span></th>
                </tr>
              </thead>
              <tbody>
                {#each lines as line, i (i)}
                  {@const t = lineTotal(line)}
                  <tr>
                    <td>
                      <div class="cell-stack">
                        <input class="input input--cell" aria-label="Beskrivelse, linje {i + 1}" bind:value={line.description} placeholder="Ydelse" />
                        <select class="select input--cell" aria-label="Konto, linje {i + 1}" bind:value={line.accountId}>
                          {#each accounts as a (a.id)}<option value={a.id}>{a.number} {a.name}{a.archived ? ' (arkiveret)' : ''}</option>{/each}
                        </select>
                      </div>
                    </td>
                    <td><input class="input input--cell input--num input--xs" aria-label="Antal, linje {i + 1}" bind:value={line.quantity} inputmode="decimal" /></td>
                    <td><input class="input input--cell input--xs" aria-label="Enhed, linje {i + 1}" bind:value={line.unit} placeholder="time" /></td>
                    <td><input class="input input--cell input--num input--short" aria-label="Pris, linje {i + 1}" bind:value={line.unitPrice} inputmode="decimal" placeholder="0,00" /></td>
                    <td class="num {t !== null && t < 0 ? 'num--neg' : ''}">{t === null ? '—' : formatOre(t, false)}</td>
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
        {#if serverProblems.length > 0 || !totals.valid}
          <ul class="problems">
            {#if totals.count === 0 || !totals.manualValid}<li class="error">Udfyld mindst én linje med beskrivelse, antal, enhed og pris.</li>{/if}
            {#each timeIssues as p (p)}<li class="error">{p}</li>{/each}
            {#each serverProblems as p (p)}
              <li class="error">{p}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
</form>

<style>
  table.lines td:first-child { width: 100%; }
  table.lines td { vertical-align: top; }
  .addline { margin-top: var(--space-3); }
  .summaryhint { margin: var(--space-4) 0 0; }
  .problems { margin: var(--space-3) 0 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-1); }
</style>
