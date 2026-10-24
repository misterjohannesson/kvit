import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';
import { unbilledSummary } from '$lib/server/services/time';

/** Billable time not on any invoice, per customer (optionally one customer). */
export const GET: RequestHandler = ({ url }) =>
  api(() => unbilledSummary(url.searchParams.get('customerId') ? Number(url.searchParams.get('customerId')) || -1 : undefined));
