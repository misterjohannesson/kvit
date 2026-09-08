import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { reconcile } from '$lib/server/services/finance';
import { badRequest } from '$lib/server/errors';

/**
 * Afstemning in one step (the MCP path): body { actualOre, date? }. Compares the
 * bank's figure with Likvider computed now, books a `correction` movement for any
 * difference, and audit-logs the reconciliation whether or not anything was booked.
 */
export const POST: RequestHandler = ({ request }) =>
  api(async () => {
    const body = (await readJson(request)) as { actualOre?: unknown; date?: unknown };
    if (typeof body?.actualOre !== 'number' || !Number.isInteger(body.actualOre)) throw badRequest('actualOre skal være et heltal i øre');
    if (body.date !== undefined && body.date !== null && typeof body.date !== 'string') throw badRequest('date skal være en dato');
    return reconcile(body.actualOre, body.date ? body.date : undefined);
  });
