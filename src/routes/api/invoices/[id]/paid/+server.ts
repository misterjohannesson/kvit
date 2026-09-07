import type { RequestHandler } from './$types';
import { api, idParam, readOptionalJson } from '$lib/server/api';
import { setPaidDate } from '$lib/server/services/invoices';
import { todayIso } from '$lib/format';

/** "Markér som betalt". Body: { paidDate?: 'yyyy-mm-dd' } (defaults to today). */
export const POST: RequestHandler = (event) =>
  api(async () => {
    const body = await readOptionalJson(event.request);
    const paidDate = body.paidDate;
    return setPaidDate(idParam(event), typeof paidDate === 'string' && paidDate ? paidDate : todayIso());
  });
