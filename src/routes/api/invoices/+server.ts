import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createDraft, listInvoices } from '$lib/server/services/invoices';
import { badRequest } from '$lib/server/errors';

export const GET: RequestHandler = ({ url }) =>
  api(() =>
    listInvoices({
      status: url.searchParams.get('status') ?? undefined,
      year: url.searchParams.get('year') ? Number(url.searchParams.get('year')) : undefined,
      unpaidOnly: url.searchParams.get('unpaid') === '1'
    })
  );

/** Create a draft. Body: { customerId }. Drafts have no number. */
export const POST: RequestHandler = ({ request }) =>
  api(async () => {
    const body = (await readJson(request)) as { customerId?: unknown };
    const customerId = Number(body?.customerId);
    if (!Number.isInteger(customerId)) throw badRequest('customerId mangler');
    return createDraft({ customerId });
  }, 201);
