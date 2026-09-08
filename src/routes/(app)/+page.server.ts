import type { PageServerLoad } from './$types';
import { listInvoices } from '$lib/server/services/invoices';
import { vatReport, yearTotals } from '$lib/server/services/vat';
import { needsSending, quarterOf, todayIso } from '$lib/format';

export const load: PageServerLoad = () => {
  const today = todayIso();
  const q = quarterOf(today);
  const all = listInvoices();
  const unpaid = all.filter((r) => r.status === 'issued' && !r.isCreditNote && !r.paidDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const vat = vatReport(q.year, q.quarter);
  return {
    today,
    quarter: q,
    unpaid,
    /** Issued documents whose date has arrived but which are not marked as sent. */
    unsent: all.filter((r) => needsSending(r, today)).sort((a, b) => a.issueDate.localeCompare(b.issueDate)),
    overdue: unpaid.filter((r) => r.dueDate < today),
    vat: { salesVatOre: vat.salesVatOre, purchaseVatOre: vat.purchaseVatOre, netVatOre: vat.netVatOre },
    ytd: yearTotals(q.year)
  };
};
