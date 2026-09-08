import type { RequestHandler } from './$types';
import { api, idParam } from '$lib/server/api';
import { getInvoiceByNumber } from '$lib/server/services/invoices';

/** Full detail of an issued document by its invoice number (drafts have none). */
export const GET: RequestHandler = (event) => api(() => getInvoiceByNumber(idParam(event, 'number')));
