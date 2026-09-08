import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';
import { vatReport } from '$lib/server/services/vat';
import { badRequest } from '$lib/server/errors';
import { quarterOf, todayIso } from '$lib/format';

export const GET: RequestHandler = ({ url }) =>
  api(() => {
    const now = quarterOf(todayIso());
    const year = Number(url.searchParams.get('year') ?? now.year);
    const quarter = Number(url.searchParams.get('quarter') ?? now.quarter);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Ugyldigt år');
    if (![1, 2, 3, 4].includes(quarter)) throw badRequest('Kvartal skal være 1-4');
    return vatReport(year, quarter);
  });
