import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createDraftFromTime } from '$lib/server/services/invoices';
import { badRequest } from '$lib/server/errors';

/** A new draft with the customer's unbilled time: { customerId, entryIds? } (default: all of it). */
export const POST: RequestHandler = ({ request }) =>
  api(async () => {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') throw badRequest('customerId mangler');
    return createDraftFromTime({ customerId: body.customerId, entryIds: body.entryIds });
  }, 201);
