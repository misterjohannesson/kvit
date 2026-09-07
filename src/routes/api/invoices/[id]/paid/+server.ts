import type { RequestHandler } from './$types';
import { api, idParam, readJson } from '$lib/server/api';
import { setPaidDate } from '$lib/server/services/invoices';
import { todayIso } from '$lib/format';

/** "Markér som betalt". Body: { paidDate?: 'yyyy-mm-dd' } (defaults to today). */
export const POST: RequestHandler = (event) =>
  api(async () => {
    const body = (await readJson(event.request).catch(() => ({}))) as { paidDate?: string } | null;
    return setPaidDate(idParam(event), body?.paidDate || todayIso());
  });
