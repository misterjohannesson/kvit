import type { RequestHandler } from './$types';
import { api, idParam } from '$lib/server/api';
import { addAttachment, listAttachments } from '$lib/server/services/attachments';
import { getInvoice } from '$lib/server/services/invoices';
import { uploadFromForm } from '$lib/server/expense-form';
import { badRequest } from '$lib/server/errors';

export const GET: RequestHandler = (event) =>
  api(() => {
    const inv = getInvoice(idParam(event));
    return listAttachments(inv.id);
  });

/** Multipart form with a `file` (PDF). Drafts only; 409 once the invoice is issued. */
export const POST: RequestHandler = (event) =>
  api(async () => {
    const ct = event.request.headers.get('content-type') ?? '';
    if (!ct.includes('multipart/form-data')) throw badRequest('Send bilaget som multipart/form-data med feltet file');
    const file = await uploadFromForm(await event.request.formData());
    if (!file) throw badRequest('Vælg en PDF-fil');
    return addAttachment(idParam(event), file);
  }, 201);
