import fs from 'node:fs';
import path from 'node:path';

/**
 * Local runs (`npm run dev`, `npm start`, `npm run seed`) read a `.env` file in
 * the working directory. Variables already present in the environment win, so a
 * developer's `.env` never overrides Docker, the test harness or the shell.
 * The file is git- and docker-ignored; `.env.example` lists the keys.
 */
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (e) {
    console.warn(`Could not read ${envFile}: ${(e as Error).message}`);
  }
}

/** Root data directory. Everything persistent lives here (DB + files). */
export const DATA_DIR = process.env.DATA_DIR ?? '/data';
export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const INVOICE_FILES_DIR = path.join(FILES_DIR, 'invoices');
export const EXPENSE_FILES_DIR = path.join(FILES_DIR, 'expenses');

/** Project root: where tokens.css / style.md / example.html and drizzle/ live. */
export const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

/**
 * Optional bearer token for the JSON API (used by the MCP server). Unset means
 * bearer authentication is disabled and only the session cookie is accepted.
 */
export function apiToken(): string | null {
  const t = process.env.API_TOKEN;
  return t && t.length > 0 ? t : null;
}

export function appPassword(): string {
  const pw = process.env.APP_PASSWORD;
  if (!pw || pw.length === 0) {
    throw new Error('APP_PASSWORD environment variable must be set (or put it in .env when running from code)');
  }
  return pw;
}
