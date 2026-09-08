import { AsyncLocalStorage } from 'node:async_hooks';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { auditLog, type AuditLog } from './schema';

export type Actor = 'ui' | 'api';

/**
 * The actor of the current request, set once by hooks.server.ts and carried
 * through every await, so services never need to pass it around. Outside a
 * request (seed, scripts, tests calling services directly) it is 'ui'.
 */
const actorStore = new AsyncLocalStorage<Actor>();

export function runWithActor<T>(actor: Actor, fn: () => T): T {
  return actorStore.run(actor, fn);
}

export function currentActor(): Actor {
  return actorStore.getStore() ?? 'ui';
}

/**
 * Append-only audit log. This is the ONLY function in the codebase that
 * writes to audit_log; there is no update or delete path anywhere.
 */
export function audit(entity: string, entityId: number, action: string, detail: unknown = {}): void {
  db.insert(auditLog)
    .values({
      timestamp: new Date().toISOString(),
      entity,
      entityId,
      action,
      detailJson: JSON.stringify(detail),
      actor: currentActor()
    })
    .run();
}

export interface AuditRow extends Omit<AuditLog, 'detailJson'> {
  detail: unknown;
}

/** Read side, newest first. Filters are exact matches; limit caps at 500. */
export function listAudit(filter: { entity?: string; entityId?: number; action?: string; actor?: Actor; limit?: number } = {}): AuditRow[] {
  const conds = [];
  if (filter.entity) conds.push(eq(auditLog.entity, filter.entity));
  if (filter.entityId !== undefined) conds.push(eq(auditLog.entityId, filter.entityId));
  if (filter.action) conds.push(eq(auditLog.action, filter.action));
  if (filter.actor) conds.push(eq(auditLog.actor, filter.actor));
  const limit = Math.min(Math.max(1, filter.limit ?? 100), 500);
  return db
    .select()
    .from(auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(limit)
    .all()
    .map(({ detailJson, ...rest }) => {
      let detail: unknown = null;
      try {
        detail = JSON.parse(detailJson);
      } catch {
        detail = detailJson;
      }
      return { ...rest, detail };
    });
}
