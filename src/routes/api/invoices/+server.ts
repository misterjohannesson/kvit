import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createDraft, deleteDraft, listInvoices, updateDraft } from '$lib/server/services/invoices';
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
 * the same request. If filling in fails validation, the empty draft is removed
 * again so the caller never leaves an orphan behind. Drafts have no number.
 */
export const POST: RequestHandler = ({ request }) =>
  api(async () => {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const customerId = Number(body?.customerId);
    if (!Number.isInteger(customerId)) throw badRequest('customerId mangler');
    const draft = createDraft({ customerId });
    const fill = ['lines', 'issueDate', 'dueDate', 'paymentReference', 'vatExemptReason'].some((k) => body && body[k] !== undefined);
    if (!fill) return draft;
    try {
      return await updateDraft(draft.id, {
        customerId,
        issueDate: body?.issueDate ?? draft.issueDate,
        dueDate: body?.dueDate ?? draft.dueDate,
        paymentReference: body?.paymentReference ?? '',
        vatExemptReason: body?.vatExemptReason ?? null,
        lines: body?.lines ?? []
      });
    } catch (e) {
      await deleteDraft(draft.id);
      throw e;
    }
  }, 201);
