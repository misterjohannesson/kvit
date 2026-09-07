import type { PageServerLoad } from './$types';
import { vatReport } from '$lib/server/services/vat';
import { listInvoiceYears } from '$lib/server/services/invoices';
import { listExpenseYears } from '$lib/server/services/expenses';
import { quarterOf, todayIso } from '$lib/format';

export const load: PageServerLoad = ({ url }) => {
  const today = todayIso();
  const now = quarterOf(today);
  const y = Number(url.searchParams.get('year'));
  const q = Number(url.searchParams.get('quarter'));
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : now.year;
  const quarter = [1, 2, 3, 4].includes(q) ? q : now.quarter;
  const years = Array.from(new Set([...listInvoiceYears(), ...listExpenseYears(), now.year])).sort((a, b) => b - a);
  return { today, year, quarter, years, report: vatReport(year, quarter) };
};
