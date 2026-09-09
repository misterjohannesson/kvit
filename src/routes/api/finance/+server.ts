import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';
import { balance, cashflow, expenseReport, ledger, ledgerCsv, resultat } from '$lib/server/services/finance';
import { badRequest } from '$lib/server/errors';
import { todayIso } from '$lib/format';

/**
 * ?view=resultat[&year=&quarter=] | expenses[&year=&quarter=] | ledger&from=&to=[&format=csv] | cashflow | balance
 * The same queries that back the three finance screens.
 */
export const GET: RequestHandler = ({ url }) =>
  api(() => {
    const view = url.searchParams.get('view');
    if (view === 'cashflow') return cashflow();
    if (view === 'balance') return balance();
    if (view === 'ledger') {
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      if (url.searchParams.get('format') === 'csv') {
        return new Response(ledgerCsv(from, to), {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="kontoudtog-${from}-${to}.csv"`, 'Cache-Control': 'no-store' }
        });
      }
      return ledger(from, to);
    }
    if (view === 'resultat' || view === 'expenses') {
      const year = Number(url.searchParams.get('year') ?? todayIso().slice(0, 4));
      const q = url.searchParams.get('quarter');
      const quarter = q ? Number(q) : null;
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Ugyldigt år');
      if (quarter !== null && ![1, 2, 3, 4].includes(quarter)) throw badRequest('Kvartal skal være 1-4');
      return view === 'resultat' ? resultat(year, quarter) : expenseReport(year, quarter);
    }
    throw badRequest('view skal være resultat, expenses, ledger, cashflow eller balance');
  });
