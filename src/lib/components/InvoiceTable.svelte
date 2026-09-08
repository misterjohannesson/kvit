<script lang="ts">
  import { formatDate, formatOre, needsSending } from '$lib/format';
  import Badge from './Badge.svelte';

  type Row = {
    id: number;
    invoiceNumber: number | null;
    status: string;
    customerName: string;
    issueDate: string;
    dueDate: string;
    paidDate: string | null;
    subtotalOre: number;
    vatOre: number;
    totalOre: number;
    isCreditNote: boolean;
    creditsInvoiceNumber: number | null;
    creditedByNumber: number | null;
    sentAt: string | null;
  };

  let {
    rows,
    today,
    footer = '',
    empty = 'Ingen fakturaer.',
    emptyAction = null,
    showTotals = true,
    dense = false
  }: {
    rows: Row[];
    today: string;
    footer?: string;
    empty?: string;
    /** The one secondary button of the empty state (style.md §3). */
    emptyAction?: { href: string; label: string } | null;
    showTotals?: boolean;
    dense?: boolean;
  } = $props();

  const sum = (k: 'subtotalOre' | 'vatOre' | 'totalOre') => rows.reduce((s, r) => s + r[k], 0);
  const neg = (n: number) => (n < 0 ? 'num num--neg' : 'num');
</script>

<div class="table-wrap">
  <table class="data {dense ? 'data--dense' : ''}">
    <thead>
      <tr>
        <th scope="col">Nr.</th>
        <th scope="col">Kunde</th>
        <th scope="col">Udstedt</th>
        <th scope="col">Forfald</th>
        <th scope="col" class="col-status">Status</th>
        <th scope="col" class="num">Beløb ekskl.</th>
        <th scope="col" class="num">Moms</th>
        <th scope="col" class="num">Beløb i alt</th>
        <th scope="col" class="col-actions"><span hidden>Handlinger</span></th>
      </tr>
    </thead>
    <tbody>
      {#if rows.length === 0}
        <tr>
          <td colspan="9" class="empty">
            {empty}
            {#if emptyAction}<a class="btn btn--sm" href={emptyAction.href}>{emptyAction.label}</a>{/if}
          </td>
        </tr>
      {/if}
      {#each rows as r (r.id)}
        <tr class="rowlink" onclick={() => (location.href = `/fakturaer/${r.id}`)}>
          <td class="mono {r.status === 'credited' ? 'void' : ''}">{r.invoiceNumber ?? '—'}</td>
          <td>
            {r.customerName}
            {#if r.status === 'credited' && r.creditedByNumber}
              <span class="cell-sub">Krediteret med {r.creditedByNumber}</span>
            {:else if r.isCreditNote}
              <span class="cell-sub">Kreditnota til {r.creditsInvoiceNumber}</span>
            {:else if r.status === 'draft'}
              <span class="cell-sub">Ikke udstedt</span>
            {/if}
          </td>
          <td class="mono">{r.status === 'draft' ? '—' : formatDate(r.issueDate)}</td>
          <td class="mono">{r.status === 'draft' || r.isCreditNote ? '—' : formatDate(r.dueDate)}</td>
          <td>
            <Badge invoice={r} {today} />
            {#if r.paidDate && r.status === 'issued'}<span class="badge-note">{r.isCreditNote ? 'refunderet ' : ''}{formatDate(r.paidDate)}</span>{/if}
            {#if needsSending(r, today)}<span class="badge badge--usendt">Ikke sendt</span>{/if}
          </td>
          <td class={neg(r.subtotalOre)}>{formatOre(r.subtotalOre, false)}</td>
          <td class={neg(r.vatOre)}>{formatOre(r.vatOre, false)}</td>
          <td class={neg(r.totalOre)}>{formatOre(r.totalOre, false)}</td>
          <td>
            <div class="row-actions">
              <a class="btn btn--ghost btn--sm" href="/fakturaer/{r.id}" onclick={(e) => e.stopPropagation()}>
                {r.status === 'draft' ? 'Redigér' : 'Vis'}
              </a>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
    {#if showTotals && rows.length > 0}
      <tfoot>
        <tr>
          <td colspan="5">{footer || `${rows.length} rækker`}</td>
          <td class={neg(sum('subtotalOre'))}>{formatOre(sum('subtotalOre'), false)}</td>
          <td class={neg(sum('vatOre'))}>{formatOre(sum('vatOre'), false)}</td>
          <td class={neg(sum('totalOre'))}>{formatOre(sum('totalOre'), false)}</td>
          <td></td>
        </tr>
      </tfoot>
    {/if}
  </table>
</div>
