/**
 * .env handling for local runs: mcp/.env is read, the app's root .env supplies API_TOKEN as a
 * fallback, and the shell always wins. Uses temp directories, never the real files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, parseEnvFile } from '../src/config.js';

const dirs: string[] = [];
function tmp(): { app: string; mcp: string } {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'kvit-mcp-env-'));
  const mcp = path.join(app, 'mcp');
  fs.mkdirSync(mcp);
  dirs.push(app);
  return { app, mcp };
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('parseEnvFile', () => {
  it('reads bare, quoted and commented values', () => {
    const r = parseEnvFile(`# c\nA=1\nB='two words # not a comment'\nC="x"\nD=plain # comment\nexport E=5\nbad line\n`);
    expect(r).toEqual({ A: '1', B: 'two words # not a comment', C: 'x', D: 'plain', E: '5' });
  });
});

describe('loadConfig with files', () => {
  it('reads mcp/.env when the shell has nothing', () => {
    const { mcp } = tmp();
    fs.writeFileSync(path.join(mcp, '.env'), 'FAKTURA_URL=http://127.0.0.1:4100/\nFAKTURA_API_TOKEN=from-mcp-env-file\n');
    const env: NodeJS.ProcessEnv = {};
    const c = loadConfig(env, mcp);
    expect(c).toEqual({ baseUrl: 'http://127.0.0.1:4100', token: 'from-mcp-env-file' });
  });

  it('falls back to the app root .env for API_TOKEN and PORT', () => {
    const { app, mcp } = tmp();
    fs.writeFileSync(path.join(app, '.env'), "APP_PASSWORD='secret'\nAPI_TOKEN=root-token-0123456789\nPORT=3456\nDATA_DIR=./data\n");
    const env: NodeJS.ProcessEnv = {};
    const c = loadConfig(env, mcp);
    expect(c).toEqual({ baseUrl: 'http://127.0.0.1:3456', token: 'root-token-0123456789' });
    // Only the two keys the MCP needs are taken from the app file.
    expect(env.APP_PASSWORD).toBeUndefined();
    expect(env.DATA_DIR).toBeUndefined();
  });

  it('the shell wins over both files, and mcp/.env wins over the root .env', () => {
    const { app, mcp } = tmp();
    fs.writeFileSync(path.join(app, '.env'), 'API_TOKEN=root-token-0123456789\n');
    fs.writeFileSync(path.join(mcp, '.env'), 'FAKTURA_API_TOKEN=mcp-token-0123456789\n');
    expect(loadConfig({}, mcp).token).toBe('mcp-token-0123456789');
    expect(loadConfig({ FAKTURA_API_TOKEN: 'shell-token-0123456789' }, mcp).token).toBe('shell-token-0123456789');
  });

  it('no files, no shell: default URL and no token', () => {
    const { mcp } = tmp();
    expect(loadConfig({}, mcp)).toEqual({ baseUrl: 'http://127.0.0.1:3000', token: null });
  });
});
