import type { RequestHandler } from './$types';
import { api, idParam, readJson } from '$lib/server/api';
import { deleteDraft, getInvoice, updateDraft } from '$lib/server/services/invoices';

export const GET: RequestHandler = (event) => api(() => getInvoice(idParam(event)));

/** Replace draft header + lines. 409 when the invoice is issued. */
export const PUT: RequestHandler = (event) =>
  api(async () => updateDraft(idParam(event), await readJson(event.request)));

export const PATCH = PUT;

/** Delete a draft. 409 when the invoice is issued: issued invoices are never deleted. */
export const DELETE: RequestHandler = (event) =>
  api(() => {
    deleteDraft(idParam(event));
    return { ok: true };
  });
