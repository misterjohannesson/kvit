import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';
import { balance, cashflow, resultat } from '$lib/server/services/finance';
import { badRequest } from '$lib/server/errors';
import { todayIso } from '$lib/format';

/**
 * ?view=resultat[&year=&quarter=] | cashflow | balance
 * The same queries that back the three finance screens.
 */
export const GET: RequestHandler = ({ url }) =>
  api(() => {
    const view = url.searchParams.get('view');
    if (view === 'cashflow') return cashflow();
    if (view === 'balance') return balance();
    if (view === 'resultat') {
      const year = Number(url.searchParams.get('year') ?? todayIso().slice(0, 4));
      const q = url.searchParams.get('quarter');
      const quarter = q ? Number(q) : null;
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Ugyldigt år');
      if (quarter !== null && ![1, 2, 3, 4].includes(quarter)) throw badRequest('Kvartal skal være 1-4');
      return resultat(year, quarter);
    }
    throw badRequest('view skal være resultat, cashflow eller balance');
  });
