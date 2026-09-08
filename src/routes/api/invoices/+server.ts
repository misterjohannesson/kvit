import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createDraft, createDraftWithContent, listInvoices, strictId } from '$lib/server/services/invoices';
import { badRequest } from '$lib/server/errors';

export const GET: RequestHandler = ({ url }) =>
  api(() =>
    listInvoices({
      status: url.searchParams.get('status') ?? undefined,
      year: url.searchParams.get('year') ? Number(url.searchParams.get('year')) : undefined,
      unpaidOnly: url.searchParams.get('unpaid') === '1'
    })
  );

/**
 * Create a draft. Body: { customerId } creates an empty draft; adding any of
 * lines / issueDate / dueDate / paymentReference / vatExemptReason fills it in
 * the same transaction, validated before anything is written. Drafts have no number.
 */
export const POST: RequestHandler = ({ request }) =>
  api(async () => {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') throw badRequest('customerId mangler');
    const fill = ['lines', 'issueDate', 'dueDate', 'paymentReference', 'vatExemptReason'].some((k) => body[k] !== undefined);
    if (!fill) return createDraft({ customerId: strictId(body.customerId, 'customerId') });
    return createDraftWithContent(body as { customerId: unknown } & Record<string, unknown>);
  }, 201);
