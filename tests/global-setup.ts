/**
 * Starts the built server (node build) against a fresh temp DATA_DIR that has
 * been seeded, and exposes its URL to the API tests via provide().
 * `npm test` runs `npm run build` first.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

export const TEST_PASSWORD = 'test-kodeord-1234';
export const TEST_API_TOKEN = 'test-api-token-abc123';

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
  throw new Error(`Server did not start within ${ms}ms`);
}

export default async function setup(project: TestProject) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faktura-test-'));
  const port = 3200 + Math.floor(Math.random() * 500);
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    APP_PASSWORD: TEST_PASSWORD,
    API_TOKEN: TEST_API_TOKEN,
    PORT: String(port),
    HOST: '127.0.0.1',
    BODY_SIZE_LIMIT: '25M',
    // Lets the login-limiter test present distinct client addresses.
    ADDRESS_HEADER: 'x-forwarded-for',
    XFF_DEPTH: '1',
    PROJECT_ROOT: process.cwd()
  };

  // Seed in-process (same DATA_DIR) before the server starts.
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const seedProc = spawn(process.execPath, [tsxCli, 'scripts/seed.ts'], { env, stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    seedProc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
    seedProc.on('error', reject);
  });

  child = spawn(process.execPath, ['build'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(baseUrl + '/login', 30000);

  project.provide('baseUrl', baseUrl);
  project.provide('dataDir', dataDir);
  project.provide('password', TEST_PASSWORD);
  project.provide('apiToken', TEST_API_TOKEN);

  return async () => {
    if (child) {
      const exited = new Promise<void>((r) => child!.once('exit', () => r()));
      child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      child = null;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
    dataDir: string;
    password: string;
    apiToken: string;
  }
}
