/**
 * Configuration from the environment, with two optional files for local runs:
 *
 *   mcp/.env          FAKTURA_URL, FAKTURA_API_TOKEN, MCP_HOST, MCP_PORT, MCP_ALLOWED_HOSTS
 *   <repo>/.env       the app's own file; its API_TOKEN (and PORT) are used when mcp/.env does
 *                     not set FAKTURA_API_TOKEN / FAKTURA_URL, so one token lives in one place
 *
 * Variables already present in the shell always win over either file. The MCP server never
 * opens the app's database; everything goes through FAKTURA_URL with the bearer token. A
 * missing token is reported per tool call as an auth error (the server still starts, so a
 * client can list the tools).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  baseUrl: string;
  token: string | null;
}

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env parser: KEY=VALUE per line, optional single or double quotes, # comments. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

function readEnvFile(file: string): Record<string, string> {
  try {
    return fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, 'utf8')) : {};
  } catch (e) {
    console.error(`[kvit-mcp] could not read ${file}: ${(e as Error).message}`);
    return {};
  }
}

/**
 * Merge the files into `env` without overriding what the shell already set. Exposed with the
 * file locations as parameters so tests can point it at temp files.
 */
export function loadEnvFiles(env: NodeJS.ProcessEnv = process.env, packageDir = PACKAGE_DIR, appDir = path.resolve(packageDir, '..')): void {
  if (env.FAKTURA_SKIP_ENV_FILES === '1') return;
  const own = readEnvFile(path.join(packageDir, '.env'));
  for (const k of ['FAKTURA_URL', 'FAKTURA_API_TOKEN', 'MCP_HOST', 'MCP_PORT', 'MCP_ALLOWED_HOSTS']) {
    if (!env[k] && own[k]) env[k] = own[k];
  }
  // The app's .env: one token in one place when running everything from the repo.
  const app = readEnvFile(path.join(appDir, '.env'));
  if (!env.FAKTURA_API_TOKEN && app.API_TOKEN) env.FAKTURA_API_TOKEN = app.API_TOKEN;
  if (!env.FAKTURA_URL && app.PORT) env.FAKTURA_URL = `http://127.0.0.1:${app.PORT}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, packageDir = PACKAGE_DIR): Config {
  loadEnvFiles(env, packageDir);
  const raw = (env.FAKTURA_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
  let baseUrl: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    baseUrl = u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    throw new Error(`FAKTURA_URL is not a valid http(s) URL: "${raw}"`);
  }
  const token = (env.FAKTURA_API_TOKEN ?? '').trim();
  return { baseUrl, token: token.length > 0 ? token : null };
}
