import fs from 'node:fs';
import type { RequestHandler } from './$types';
import { api, errorResponse, idParam } from '$lib/server/api';
import { attachmentAbsolutePath, getAttachment, removeAttachment } from '$lib/server/services/attachments';
import { notFound } from '$lib/server/errors';

/** The uploaded original. On issued invoices the same pages also sit inside the archived PDF. */
export const GET: RequestHandler = (event) => {
  try {
    const a = getAttachment(idParam(event), idParam(event, 'aid'));
    const abs = attachmentAbsolutePath(a);
    if (!fs.existsSync(abs)) throw notFound('Bilaget findes ikke på disken');
    const disposition = event.url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    return new Response(fs.readFileSync(abs), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${a.name.replace(/["\\]/g, '_')}"`
      }
    });
  } catch (e) {
    return errorResponse(e);
  }
};

/** Drafts only; 409 once the invoice is issued. */
export const DELETE: RequestHandler = (event) =>
  api(async () => {
    await removeAttachment(idParam(event), idParam(event, 'aid'));
    return { ok: true };
  });
