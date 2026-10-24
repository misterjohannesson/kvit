import type { RequestHandler } from './$types';
import { api, idParam } from '$lib/server/api';
import { getInvoice } from '$lib/server/services/invoices';
import { invoiceTime } from '$lib/server/services/time';

/** The invoice's time section: rows in print order with logged vs invoiced hours and value. */
export const GET: RequestHandler = (event) =>
  api(() => {
    const id = idParam(event);
    getInvoice(id);
    return invoiceTime(id);
  });
