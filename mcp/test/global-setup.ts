/**
 * Boots the app (../build, built by the app's `npm run build`) against a fresh,
 * seeded temp DATA_DIR with an API_TOKEN, and hands the URL and token to the
 * tool tests. The MCP under test only ever talks HTTP to this instance.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

export const TEST_TOKEN = 'mcp-test-token-xyz';
const APP_ROOT = path.resolve(process.cwd(), '..');

let child: ChildProcess | null = null;
let dataDir = '';

async function waitFor(url: string, ms: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`App did not start within ${ms}ms`);
}

export default async function setup(project: TestProject) {
  if (!fs.existsSync(path.join(APP_ROOT, 'build', 'index.js'))) {
    throw new Error(`App build missing at ${APP_ROOT}/build. Run "npm run build" in the app root first.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvit-mcp-test-'));
  const port = 3700 + Math.floor(Math.random() * 300);
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    APP_PASSWORD: 'mcp-test-password',
    API_TOKEN: TEST_TOKEN,
    PORT: String(port),
    HOST: '127.0.0.1',
    PROJECT_ROOT: APP_ROOT
  };
  const tsxCli = path.join(APP_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const seed = spawn(process.execPath, [tsxCli, 'scripts/seed.ts'], { cwd: APP_ROOT, env, stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
    seed.on('error', reject);
  });

  child = spawn(process.execPath, ['build'], { cwd: APP_ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(baseUrl + '/login', 30000);

  project.provide('baseUrl', baseUrl);
  project.provide('token', TEST_TOKEN);
  project.provide('dataDir', dataDir);

  return async () => {
    child?.kill();
    child = null;
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
    token: string;
    dataDir: string;
  }
}
