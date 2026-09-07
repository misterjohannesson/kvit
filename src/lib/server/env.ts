import path from 'node:path';

/** Root data directory. Everything persistent lives here (DB + files). */
export const DATA_DIR = process.env.DATA_DIR ?? '/data';
export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const INVOICE_FILES_DIR = path.join(FILES_DIR, 'invoices');
export const EXPENSE_FILES_DIR = path.join(FILES_DIR, 'expenses');

/** Project root: where tokens.css / style.md / example.html and drizzle/ live. */
export const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

export function appPassword(): string {
  const pw = process.env.APP_PASSWORD;
  if (!pw || pw.length === 0) {
    throw new Error('APP_PASSWORD environment variable must be set');
  }
  return pw;
}
