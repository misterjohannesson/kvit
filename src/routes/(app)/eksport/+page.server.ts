import type { PageServerLoad } from './$types';
import { countRows } from '$lib/server/db';
import { account, auditLog, cashMovement, expense, invoice, invoiceLine } from '$lib/server/schema';
import fs from 'node:fs';
import path from 'node:path';
import { FILES_DIR } from '$lib/server/env';

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? countFiles(path.join(dir, d.name)) : 1), 0);
}

export const load: PageServerLoad = () => ({
  counts: {
    invoices: countRows(invoice),
    lines: countRows(invoiceLine),
    expenses: countRows(expense),
    movements: countRows(cashMovement),
    accounts: countRows(account),
    audit: countRows(auditLog),
    files: countFiles(FILES_DIR)
  }
});
