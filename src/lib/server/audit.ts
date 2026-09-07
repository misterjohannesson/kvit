import { db } from './db';
import { auditLog } from './schema';

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
      detailJson: JSON.stringify(detail)
    })
    .run();
}
