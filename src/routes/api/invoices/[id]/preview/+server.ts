import type { RequestHandler } from './$types';
import { errorResponse, idParam } from '$lib/server/api';
import { previewDraftPdf } from '$lib/server/services/invoices';

/**
 * Draft preview: the collected PDF (invoice + attachments) as it would look if
 * issued now, marked UDKAST. Rendered per request, never stored or cached; the
 * legal document only ever comes from issuing (see /pdf).
 */
export const GET: RequestHandler = async (event) => {
  try {
    const pdf = await previewDraftPdf(idParam(event));
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="udkast.pdf"',
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return errorResponse(e);
  }
};
