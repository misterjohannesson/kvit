import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createTimeEntry, listTimeEntries } from '$lib/server/services/time';
import { badRequest } from '$lib/server/errors';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Logged time. Filters: customerId, status (unbilled | draft | billed | not_billable), from, to (yyyy-mm-dd). */
export const GET: RequestHandler = ({ url }) =>
  api(() => {
    const q = url.searchParams;
    const customerId = q.get('customerId') ? Number(q.get('customerId')) : undefined;
    if (customerId !== undefined && (!Number.isInteger(customerId) || customerId <= 0)) throw badRequest('customerId skal være et positivt heltal');
    const status = q.get('status') ?? undefined;
    if (status !== undefined && !['unbilled', 'draft', 'billed', 'not_billable'].includes(status)) throw badRequest('status skal være unbilled, draft, billed eller not_billable');
    for (const k of ['from', 'to']) if (q.get(k) && !DATE.test(q.get(k)!)) throw badRequest(`${k} skal være åååå-mm-dd`);
    return listTimeEntries({ customerId, status, from: q.get('from') ?? undefined, to: q.get('to') ?? undefined });
  });

/** Log time: { customerId, date, hours | minutes, description, billable? }. */
export const POST: RequestHandler = ({ request }) => api(async () => createTimeEntry(await readJson(request)), 201);
