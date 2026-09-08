import type { PageServerLoad } from './$types';
import { resultat } from '$lib/server/services/finance';
import { listInvoiceYears } from '$lib/server/services/invoices';
import { listExpenseYears } from '$lib/server/services/expenses';
import { todayIso } from '$lib/format';

export const load: PageServerLoad = ({ url }) => {
  const thisYear = Number(todayIso().slice(0, 4));
  const y = Number(url.searchParams.get('year'));
  const q = url.searchParams.get('quarter');
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : thisYear;
  const quarter = q && ['1', '2', '3', '4'].includes(q) ? Number(q) : null;
  const years = Array.from(new Set([...listInvoiceYears(), ...listExpenseYears(), thisYear])).sort((a, b) => b - a);
  return { year, quarter, years, report: resultat(year, quarter) };
};
