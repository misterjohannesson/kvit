import type { RequestHandler } from './$types';
import { api, idParam } from '$lib/server/api';
import { creditInvoice } from '$lib/server/services/invoices';

export const POST: RequestHandler = (event) => api(() => creditInvoice(idParam(event)), 201);
