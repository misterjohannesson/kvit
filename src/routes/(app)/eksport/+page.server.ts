import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { auditLog, expense, invoice, invoiceLine } from '$lib/server/schema';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { FILES_DIR } from '$lib/server/env';

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? countFiles(path.join(dir, d.name)) : 1), 0);
}

export const load: PageServerLoad = () => {
  const count = (t: typeof invoice | typeof invoiceLine | typeof expense | typeof auditLog) =>
    db.select({ n: sql<number>`count(*)` }).from(t).get()?.n ?? 0;
  return {
    counts: {
      invoices: count(invoice),
      lines: count(invoiceLine),
      expenses: count(expense),
      audit: count(auditLog),
      files: countFiles(FILES_DIR)
    }
  };
};
