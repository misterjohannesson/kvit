<script lang="ts">
  import { formatDate, formatOre, formatQuantity, minutesToHours } from '$lib/format';
  import { entryFigures, groupFigures, groupMembers, normalize, type EditorTimeRow } from '$lib/time-rows';
  import InfoTip from './InfoTip.svelte';

  type Available = { id: number; date: string; minutes: number; description: string };

  let {
    rows = $bindable(),
    available,
    customerRateOre,
    error
  }: {
    rows: EditorTimeRow[];
    /** Unbilled entries of the customer, as loaded; the ones already in `rows` are hidden. */
    available: Available[];
    customerRateOre: number | null;
    error?: string;
  } = $props();

  let picked = $state<number[]>([]);
  let keySeq = 0;
  const newKey = () => `n${++keySeq}`;

  const onDraft = $derived(new Set(rows.filter((r) => r.type === 'entry').map((r) => (r.type === 'entry' ? r.entryId : 0))));
  const pickable = $derived(available.filter((a) => !onDraft.has(a.id)));

  const signed = (n: number, fmt: (x: number) => string) => (n > 0 ? '+' : '') + fmt(n);
  const diffCls = (n: number | null) => (n !== null && n < 0 ? 'num--neg' : '');

  function addPicked() {
    for (const a of pickable.filter((p) => picked.includes(p.id)).sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id)) {
      rows.push({
        type: 'entry',
        key: newKey(),
        entryId: a.id,
        indent: false,
        date: a.date,
        minutes: a.minutes,
        loggedDescription: a.description,
        invoicedHours: formatQuantity(minutesToHours(a.minutes)),
        invoicedDescription: a.description,
        rate: customerRateOre === null ? '' : formatOre(customerRateOre, false),
        standardRateOre: customerRateOre
      });
    }
    picked = [];
  }

  /** A heading goes on top; "Saml alle under" then tabs everything below it in. */
  function addGroup() {
    rows.unshift({ type: 'group', key: newKey(), description: '' });
  }

  function indent(i: number) {
    const r = rows[i];
    if (r.type !== 'entry') return;
    const prev = rows[i - 1];
    if (!prev || (prev.type === 'entry' && !prev.indent)) return;
    r.indent = true;
  }

  /** Outdenting from the middle of a heading moves the line below the heading's last line, so the rest stay under it. */
  function outdent(i: number) {
    const r = rows[i];
    if (r.type !== 'entry' || !r.indent) return;
    r.indent = false;
    let end = i;
    while (rows[end + 1]?.type === 'entry' && (rows[end + 1] as { indent: boolean }).indent) end++;
    if (end > i) {
      const [moved] = rows.splice(i, 1);
      rows.splice(end, 0, moved);
    }
  }

  function move(i: number, by: -1 | 1) {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    normalize(rows);
  }

  function gatherBelow(i: number) {
    for (let j = i + 1; j < rows.length; j++) {
      const r = rows[j];
      if (r.type === 'group') break;
      r.indent = true;
    }
  }

  function remove(i: number) {
    rows.splice(i, 1);
    normalize(rows);
  }

  /** Alt+→ / Alt+← indent and outdent, Alt+↑ / Alt+↓ move the row. */
  function keys(e: KeyboardEvent, i: number) {
    if (!e.altKey) return;
    const act = { ArrowRight: () => indent(i), ArrowLeft: () => outdent(i), ArrowUp: () => move(i, -1), ArrowDown: () => move(i, 1) }[e.key];
    if (act) {
      e.preventDefault();
      act();
    }
  }

  const canIndent = (i: number) => {
    const r = rows[i];
    const prev = rows[i - 1];
    return r.type === 'entry' && !r.indent && !!prev && (prev.type === 'group' || prev.indent);
  };
</script>

<fieldset class="field--span-12">
  <legend>Timer</legend>
  {#if error}<p class="error formerror">{error}</p>{/if}
  {#if rows.length > 0}
    <div class="table-wrap">
      <table class="data data--dense lines timelines">
        <thead>
          <tr>
            <th scope="col">Tekst på fakturaen <InfoTip label="Om teksten">Det, der står på fakturaen. Under feltet ser du dato og tekst fra registreringen, som er låst. Står linjen under en overskrift, trykkes overskriftens tekst i stedet.</InfoTip></th>
            <th scope="col" class="num">Timer <InfoTip label="Om timerne">De timer, kunden betaler for. Rund op eller ned, som du vil; den loggede tid under feltet ændres ikke.</InfoTip></th>
            <th scope="col" class="num">Timepris <InfoTip label="Om timeprisen">Starter på kundens timepris og kan rettes pr. linje. På en overskrift er prisen beløbet delt med timerne, så linjer med forskellig pris kan stå under samme overskrift.</InfoTip></th>
            <th scope="col" class="num">Beløb <InfoTip label="Om afvigelsen">Den lille linje under beløbet er afvigelsen fra den loggede tid: kroner målt mod kundens timepris og timer mod det loggede. Plus betyder, at du fakturerer mere, end du har logget.</InfoTip></th>
            <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (row.key)}
            {#if row.type === 'group'}
              {@const g = groupFigures(rows, i)}
              <tr class="timelines__group" onkeydown={(e) => keys(e, i)}>
                <td><input class="input input--cell" aria-label="Overskrift, linje {i + 1}" bind:value={row.description} placeholder="Overskrift, fx Konsulentbistand oktober" /></td>
                <td class="num">{formatQuantity(g.hours)}<span class="cell-sub">logget {formatQuantity(groupMembers(rows, i).reduce((s, m) => s + m.minutes, 0) / 60)}</span></td>
                <td class="num" title="Beløb / timer">{g.rate === null ? '—' : formatOre(g.rate, false)}<span class="cell-sub">beløb / timer</span></td>
                <td class="num">
                  {g.total === null ? '—' : formatOre(g.total, false)}
                  <span class="cell-sub {diffCls(g.diffOre)}">{g.diffOre === null ? '' : `${signed(g.diffOre, (x) => formatOre(x, false))} · ${signed(g.diffHours, formatQuantity)} t`}</span>
                </td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn--ghost btn--sm" onclick={() => gatherBelow(i)} title="Ryk alle linjer nedenfor ind under overskriften">Saml</button>
                    <button type="button" class="btn btn--ghost btn--sm" aria-label="Flyt op" title="Flyt op (Alt+↑)" onclick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" class="btn btn--ghost btn--sm" aria-label="Flyt ned" title="Flyt ned (Alt+↓)" onclick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</button>
                    <button type="button" class="btn btn--ghost btn--sm" aria-label="Fjern overskrift" title="Fjern overskriften; linjerne bliver stående" onclick={() => remove(i)}>✕</button>
                  </div>
                </td>
              </tr>
            {:else}
              {@const f = entryFigures(row)}
              <tr class={row.indent ? 'timelines__child' : ''} onkeydown={(e) => keys(e, i)}>
                <td class="wrap">
                  <div class="cell-stack">
                    <input class="input input--cell" aria-label="Tekst, linje {i + 1}" bind:value={row.invoicedDescription} />
                    <span class="cell-sub"><span class="mono">{formatDate(row.date)}</span> · {row.loggedDescription}</span>
                  </div>
                </td>
                <td class="num">
                  <input class="input input--cell input--num input--xs" aria-label="Fakturerede timer, linje {i + 1}" bind:value={row.invoicedHours} inputmode="decimal" />
                  <span class="cell-sub">logget {formatQuantity(row.minutes / 60)}</span>
                </td>
                <td class="num"><input class="input input--cell input--num input--short" aria-label="Timepris, linje {i + 1}" bind:value={row.rate} inputmode="decimal" placeholder="0,00" /></td>
                <td class="num">
                  {f.total === null ? '—' : formatOre(f.total, false)}
                  <span class="cell-sub {diffCls(f.diffOre)}">{f.diffOre === null || f.diffHours === null ? '' : `${signed(f.diffOre, (x) => formatOre(x, false))} · ${signed(f.diffHours, formatQuantity)} t`}</span>
                </td>
                <td>
                  <div class="row-actions">
                    {#if row.indent}
                      <button type="button" class="btn btn--ghost btn--sm" aria-label="Ryk ud" title="Ryk ud (Alt+←)" onclick={() => outdent(i)}>⇤</button>
                    {:else}
                      <button type="button" class="btn btn--ghost btn--sm" aria-label="Ryk ind under overskriften" title="Ryk ind under overskriften (Alt+→)" onclick={() => indent(i)} disabled={!canIndent(i)}>⇥</button>
                    {/if}
                    <button type="button" class="btn btn--ghost btn--sm" aria-label="Flyt op" title="Flyt op (Alt+↑)" onclick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" class="btn btn--ghost btn--sm" aria-label="Flyt ned" title="Flyt ned (Alt+↓)" onclick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</button>
                    <button type="button" class="btn btn--ghost btn--sm" aria-label="Fjern fra kladden" title="Fjern fra kladden; tiden bliver ufaktureret igen" onclick={() => remove(i)}>✕</button>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="timepick">
    {#if pickable.length > 0}
      <details open={rows.length === 0}>
        <summary>Tilføj registreret tid ({pickable.length} ufakturerede)</summary>
        <ul class="timepick__list">
          {#each pickable as a (a.id)}
            <li>
              <label class="check">
                <input type="checkbox" value={a.id} bind:group={picked} />
                <span class="mono">{formatDate(a.date)}</span>
                <span class="mono">{formatQuantity(minutesToHours(a.minutes))} t</span>
                <span>{a.description}</span>
              </label>
            </li>
          {/each}
        </ul>
        <p class="timepick__actions">
          <button type="button" class="btn btn--sm" onclick={() => (picked = pickable.map((p) => p.id))}>Vælg alle</button>
          <button type="button" class="btn btn--sm btn--primary" onclick={addPicked} disabled={picked.length === 0}>Tilføj valgte</button>
        </p>
      </details>
    {:else if rows.length === 0}
      <p class="hint">Kunden har ingen ufaktureret tid. Registrér tid under <a href="/timer">Timer</a>.</p>
    {/if}
    {#if rows.some((r) => r.type === 'entry')}
      <span class="timepick__group">
        <button type="button" class="btn btn--sm" onclick={addGroup}>Tilføj overskrift</button>
        <InfoTip label="Om overskrifter">Overskriften lægger sig øverst. Ryk linjer ind under den med ⇥ (eller Alt+→), eller tryk <em>Saml</em> for at tage alle linjerne nedenfor. Kunden ser én linje med overskriftens tekst og summen af timer og beløb.</InfoTip>
      </span>
    {/if}
  </div>
</fieldset>

<style>
  table.timelines td:first-child { width: 100%; }
  table.timelines td { vertical-align: top; }
  .timelines__group td { background: var(--bg-surface-sunk); }
  .timelines__child td:first-child { padding-left: var(--space-8); }
  .timepick { margin-top: var(--space-3); display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
  .timepick details { width: 100%; }
  .timepick summary { cursor: pointer; font-weight: var(--weight-medium); }
  .timepick__list { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .timepick__list .check { display: flex; gap: var(--space-3); align-items: baseline; }
  .timepick__group { display: inline-flex; align-items: center; gap: var(--space-1); }
  .timepick__actions { display: flex; gap: var(--space-2); margin: var(--space-2) 0 0; }
</style>
