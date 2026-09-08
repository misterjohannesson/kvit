import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';
import { listAudit, type Actor } from '$lib/server/audit';
import { badRequest } from '$lib/server/errors';

/**
 * Read the append-only audit trail, newest first.
 * ?entity=invoice&entityId=5&action=mark_paid&actor=api&limit=50 (all optional).
 */
export const GET: RequestHandler = ({ url }) =>
  api(() => {
    const q = url.searchParams;
    const entityId = q.get('entityId');
    const actor = q.get('actor');
    if (actor && actor !== 'ui' && actor !== 'api') throw badRequest('actor skal være ui eller api');
    if (entityId && !/^\d+$/.test(entityId)) throw badRequest('entityId skal være et heltal');
    const limit = q.get('limit');
    if (limit && !/^\d+$/.test(limit)) throw badRequest('limit skal være et heltal');
    return listAudit({
      entity: q.get('entity') ?? undefined,
      entityId: entityId ? Number(entityId) : undefined,
      action: q.get('action') ?? undefined,
      actor: (actor as Actor | null) ?? undefined,
      limit: limit ? Number(limit) : undefined
    });
  });
