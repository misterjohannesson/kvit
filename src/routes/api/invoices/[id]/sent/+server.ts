import type { RequestHandler } from './$types';
import { api, idParam, readOptionalJson } from '$lib/server/api';
import { markSent } from '$lib/server/services/invoices';
import { todayIso } from '$lib/format';
import { badRequest } from '$lib/server/errors';

/** "Markér som sendt". Body: { sentAt?: 'yyyy-mm-dd' } (defaults to today). Set once; 409 on drafts and repeats. */
export const POST: RequestHandler = (event) =>
  api(async () => {
    const body = await readOptionalJson(event.request);
    const sentAt = body.sentAt;
    if (sentAt !== undefined && sentAt !== null && typeof sentAt !== 'string') throw badRequest('sentAt skal være en dato');
    return markSent(idParam(event), sentAt ? sentAt : todayIso());
  });
