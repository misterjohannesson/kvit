import type { PageServerLoad } from './$types';
import { listInvoices } from '$lib/server/services/invoices';
import { vatReport, yearTotals } from '$lib/server/services/vat';
import { quarterOf, todayIso } from '$lib/format';

export const load: PageServerLoad = () => {
  const today = todayIso();
  const q = quarterOf(today);
  const unpaid = listInvoices({ unpaidOnly: true }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const vat = vatReport(q.year, q.quarter);
  return {
    today,
    quarter: q,
    unpaid,
    overdue: unpaid.filter((r) => r.dueDate < today),
    vat: { salesVatOre: vat.salesVatOre, purchaseVatOre: vat.purchaseVatOre, netVatOre: vat.netVatOre },
    ytd: yearTotals(q.year)
  };
};
