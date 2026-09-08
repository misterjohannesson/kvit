import type { RequestHandler } from './$types';
import { api, idParam, readOptionalJson } from '$lib/server/api';
import { setPaidDate } from '$lib/server/services/invoices';
import { todayIso } from '$lib/format';
import { badRequest } from '$lib/server/errors';

/** "Markér som betalt" (on a credit note: refunded). Body: { paidDate?: 'yyyy-mm-dd' } (defaults to today). */
export const POST: RequestHandler = (event) =>
  api(async () => {
    const body = await readOptionalJson(event.request);
    const paidDate = body.paidDate;
    if (paidDate !== undefined && paidDate !== null && typeof paidDate !== 'string') throw badRequest('paidDate skal være en dato');
    return setPaidDate(idParam(event), paidDate ? paidDate : todayIso());
  });
