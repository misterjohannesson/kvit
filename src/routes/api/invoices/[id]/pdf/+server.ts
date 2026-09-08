import fs from 'node:fs';
import type { RequestHandler } from './$types';
import { errorResponse, idParam } from '$lib/server/api';
import { getInvoice, invoicePdfAbsolutePath } from '$lib/server/services/invoices';
import { notFound } from '$lib/server/errors';

/** The stored legal artifact. Never regenerated. */
export const GET: RequestHandler = (event) => {
  try {
    const inv = getInvoice(idParam(event));
    const abs = invoicePdfAbsolutePath(inv);
    if (!abs || !fs.existsSync(abs)) throw notFound('PDF findes ikke');
    const name = `${inv.isCreditNote ? 'kreditnota' : 'faktura'}-${inv.invoiceNumber}.pdf`;
    const disposition = event.url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    return new Response(fs.readFileSync(abs), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${name}"`
      }
    });
  } catch (e) {
    return errorResponse(e);
  }
};
