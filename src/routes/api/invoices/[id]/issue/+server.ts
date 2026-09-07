import type { RequestHandler } from './$types';
import { api, idParam } from '$lib/server/api';
import { issueInvoice } from '$lib/server/services/invoices';

export const POST: RequestHandler = (event) => api(() => issueInvoice(idParam(event)));
