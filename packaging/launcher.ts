/**
 * Faktura standalone binary (built with `bun build --compile`, see build-binaries.mjs).
 *
 * The binary carries the complete runtime tree (SvelteKit build, production
 * node_modules, migrations, design files, MCP server) as an embedded tarball.
 * On start it
 *   1. finds faktura.config.json (--config, FAKTURA_CONFIG, ./, ~/faktura/) or runs
 *      the four-question wizard and writes the file next to the data directory,
 *   2. unpacks the runtime for this version next to the config (once),
 *   3. downloads the pinned Chromium into <data>/chromium on first run (the app
 *      refuses to issue invoices until it is there),
 *   4. starts the app and the MCP HTTP server as child processes.
 *
 * The children are this very binary run with BUN_BE_BUN=1, which makes a compiled
 * Bun executable behave as the plain `bun` runtime, so the extracted Node tree runs
 * from disk with ordinary node_modules resolution. `faktura --mcp-stdio` runs the
 * MCP server over stdio for local AI clients.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { extract } from 'tar';
import runtimeTar from './stage/runtime.tar.gz' with { type: 'file' };
import RUNTIME_VERSION from './stage/VERSION' with { type: 'text' };

const VERSION = String(RUNTIME_VERSION).trim();

interface Config {
  version: 1;
  dataDir: string;
  port: number;
  host: string;
  mcpPort: number;
  appPassword: string;
  apiToken: string;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const nonInteractive = process.env.FAKTURA_NONINTERACTIVE === '1' || !process.stdin.isTTY;

const log = (s = '') => console.error(s);
const line = () => log('────────────────────────────────────────────────────────────');

if (flag('--help') || flag('-h')) {
  log(`Faktura ${VERSION}

  faktura                      start (runs the setup wizard on first start)
  faktura --config <file>      use this configuration file
  faktura --mcp-stdio          run the MCP server over stdio (for AI clients)
  faktura --install-chromium   download the PDF engine now
  faktura --version

Environment for non-interactive setup: FAKTURA_NONINTERACTIVE=1, FAKTURA_DIR (base directory; data goes in
FAKTURA_DIR/data), FAKTURA_PORT, FAKTURA_HOST, APP_PASSWORD, API_TOKEN (or "generate"), FAKTURA_SKIP_CHROMIUM=1.`);
  process.exit(0);
}
if (flag('--version')) {
  console.log(VERSION);
  process.exit(0);
}

// ---------------------------------------------------------------- prompts (secrets never echoed)

async function ask(question: string, def: string): Promise<string> {
  process.stderr.write(`${question} [${def}]: `);
  const answer = await readLine(false);
  return answer.trim() === '' ? def : answer.trim();
}

async function askSecret(question: string): Promise<string> {
  process.stderr.write(`${question}: `);
  const answer = await readLine(true);
  process.stderr.write('\n');
  return answer;
}

function readLine(hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buf = '';
    const raw = hidden && stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '') {
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData);
          if (raw) stdin.setRawMode(false);
          stdin.pause();
          resolve(buf);
          return;
        }
        if (ch === '' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------- config

function findConfigPath(): string | null {
  // An explicit --config is decisive: if that file does not exist yet, the wizard creates it there.
  const explicit = opt('--config');
  if (explicit) return fs.existsSync(explicit) ? path.resolve(explicit) : null;
  const candidates = [process.env.FAKTURA_CONFIG, path.resolve('faktura.config.json'), path.join(os.homedir(), 'faktura', 'faktura.config.json')];
  for (const c of candidates) if (c && fs.existsSync(c)) return path.resolve(c);
  return null;
}

function readConfig(p: string): Config {
  const c = JSON.parse(fs.readFileSync(p, 'utf8')) as Config;
  if (!c.dataDir || !c.appPassword || !c.apiToken) throw new Error(`Configuration ${p} is incomplete (dataDir, appPassword, apiToken required)`);
  c.dataDir = path.resolve(path.dirname(p), c.dataDir);
  c.port = Number(c.port) || 3000;
  c.mcpPort = Number(c.mcpPort) || 3333;
  c.host = c.host || '127.0.0.1';
  return c;
}

async function wizard(): Promise<{ configPath: string; config: Config }> {
  line();
  log(`Faktura ${VERSION} — first start`);
  log('Four questions. Enter keeps the value in brackets. Nothing you type as a password or token is shown or logged.');
  line();
  const env = process.env;
  const explicitFile = opt('--config') ? path.resolve(opt('--config')!) : undefined;
  const defaultBase = explicitFile ? path.dirname(explicitFile) : (env.FAKTURA_DIR ?? path.join(os.homedir(), 'faktura'));
  const base = path.resolve(nonInteractive ? defaultBase : await ask('Directory for configuration and data', defaultBase));
  const portStr = nonInteractive ? (env.FAKTURA_PORT ?? '3000') : await ask('Port for the web app', env.FAKTURA_PORT ?? '3000');
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be a number between 1 and 65535');

  let password = nonInteractive ? (env.APP_PASSWORD ?? '') : '';
  while (password.length < 8) {
    if (nonInteractive) throw new Error('APP_PASSWORD must be at least 8 characters');
    password = await askSecret('App password (the one login; at least 8 characters)');
    if (password.length < 8) log('At least 8 characters, please.');
  }
  let token = nonInteractive ? (env.API_TOKEN ?? 'generate') : await askSecret('API token for AI/MCP access (Enter = generate one)');
  let generated = false;
  if (token === '' || token === 'generate') {
    token = randomBytes(24).toString('hex');
    generated = true;
  }
  if (token.length < 16) throw new Error('API_TOKEN must be at least 16 characters');

  fs.mkdirSync(path.join(base, 'data'), { recursive: true });
  const configPath = explicitFile ?? path.join(base, 'faktura.config.json');
  const config: Config = { version: 1, dataDir: 'data', port, host: env.FAKTURA_HOST ?? '127.0.0.1', mcpPort: Number(env.FAKTURA_MCP_PORT ?? 3333), appPassword: password, apiToken: token };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    /* Windows */
  }
  log(`Configuration written to ${configPath} (private: it holds the password and the token).`);
  if (process.platform === 'win32') {
    const me = Bun.spawnSync(['cmd', '/c', 'whoami']).stdout.toString().trim();
    if (me) Bun.spawnSync(['icacls', configPath, '/inheritance:r', '/grant:r', `${me}:(F)`]);
  }
  if (base !== path.join(os.homedir(), 'faktura')) log(`Start with: ${process.execPath} --config ${configPath}`);
  if (generated && !nonInteractive) log('An API token was generated and stored in that file.');
  return { configPath, config: readConfig(configPath) };
}

// ---------------------------------------------------------------- runtime extraction

async function ensureRuntime(base: string): Promise<string> {
  const dir = path.join(base, 'runtime', VERSION);
  const marker = path.join(dir, '.complete');
  if (fs.existsSync(marker)) return dir;
  log(`Unpacking Faktura ${VERSION} runtime into ${dir} …`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(base, `runtime-${VERSION}.tar.gz.tmp`);
  fs.writeFileSync(tmp, new Uint8Array(await Bun.file(runtimeTar).arrayBuffer()));
  await extract({ file: tmp, cwd: dir });
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(marker, new Date().toISOString());
  return dir;
}

/** Older runtimes are removed only once the new app is serving, never from --mcp-stdio (an old app may still run). */
function pruneOldRuntimes(base: string): void {
  try {
    for (const e of fs.readdirSync(path.join(base, 'runtime'))) {
      if (e !== VERSION) fs.rmSync(path.join(base, 'runtime', e), { recursive: true, force: true });
    }
  } catch {
    /* still in use by a previous instance; try again next start */
  }
}

// ---------------------------------------------------------------- child processes (this binary as plain bun)

type Child = ReturnType<typeof Bun.spawn>;

function runtimeChild(runtime: string, script: string[], env: Record<string, string | undefined>, stdio: 'inherit' | 'pipe' = 'inherit'): Child {
  return Bun.spawn([process.execPath, ...script], {
    cwd: runtime,
    env: { ...process.env, ...env, BUN_BE_BUN: '1' },
    stdin: 'inherit',
    stdout: stdio,
    stderr: 'inherit'
  });
}

async function chromiumExecutable(runtime: string, browsersPath: string): Promise<string> {
  const child = runtimeChild(runtime, ['-e', "console.log(require('playwright').chromium.executablePath())"], { PLAYWRIGHT_BROWSERS_PATH: browsersPath }, 'pipe');
  const out = await new Response(child.stdout).text();
  await child.exited;
  return out.trim();
}

async function installChromium(runtime: string, browsersPath: string): Promise<number> {
  // Playwright's own installer, pinned to the playwright version inside the runtime.
  const child = runtimeChild(runtime, [path.join('node_modules', 'playwright-core', 'cli.js'), 'install', 'chromium'], { PLAYWRIGHT_BROWSERS_PATH: browsersPath });
  return child.exited;
}

async function ensureChromium(runtime: string, dataDir: string): Promise<boolean> {
  const browsersPath = path.join(dataDir, 'chromium');
  const exe = await chromiumExecutable(runtime, browsersPath);
  if (exe && fs.existsSync(exe)) return true;
  if (process.env.FAKTURA_SKIP_CHROMIUM === '1') {
    log('PDF engine (Chromium) not downloaded (FAKTURA_SKIP_CHROMIUM=1). Invoices cannot be issued until it is.');
    return false;
  }
  line();
  log('Faktura needs Chromium to render invoice PDFs. It is downloaded once (about 150 MB) into');
  log(`  ${browsersPath}`);
  log('Until it is present the app runs, but refuses to issue invoices.');
  if (!nonInteractive) {
    const a = await ask('Download now?', 'Y');
    if (!/^y/i.test(a)) return false;
  }
  const code = await installChromium(runtime, browsersPath);
  if (code !== 0) {
    log(`Chromium download failed (exit ${code}). Start again to retry; invoices cannot be issued until it succeeds.`);
    log('On Linux the browser also needs system libraries: see "npx playwright install-deps chromium" or your distribution\'s package list.');
    return false;
  }
  log('Chromium is ready.');
  return true;
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  let configPath = findConfigPath();
  let config: Config;
  if (configPath) {
    config = readConfig(configPath);
  } else if (flag('--mcp-stdio')) {
    throw new Error('No faktura.config.json found. Start the app once to run the setup wizard.');
  } else {
    ({ configPath, config } = await wizard());
  }
  const base = path.dirname(configPath);
  const runtime = await ensureRuntime(base);
  const browsersPath = path.join(config.dataDir, 'chromium');

  const appEnv = {
    DATA_DIR: config.dataDir,
    PROJECT_ROOT: runtime,
    APP_PASSWORD: config.appPassword,
    API_TOKEN: config.apiToken,
    PORT: String(config.port),
    HOST: config.host,
    BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT ?? '25M',
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  };
  const mcpEnv = {
    FAKTURA_URL: `http://127.0.0.1:${config.port}`,
    FAKTURA_API_TOKEN: config.apiToken,
    MCP_HOST: '127.0.0.1',
    MCP_PORT: String(config.mcpPort),
    MCP_ALLOWED_HOSTS: `localhost:${config.mcpPort},127.0.0.1:${config.mcpPort}`
  };

  if (flag('--mcp-stdio')) {
    const child = runtimeChild(runtime, [path.join('mcp', 'dist', 'stdio.js')], mcpEnv);
    process.exit(await child.exited);
  }
  if (flag('--install-chromium')) {
    process.exit(await installChromium(runtime, browsersPath));
  }

  const hasChromium = await ensureChromium(runtime, config.dataDir);

  const app = runtimeChild(runtime, [path.join('build', 'index.js')], appEnv);
  const mcp = runtimeChild(runtime, [path.join('mcp', 'dist', 'http.js')], mcpEnv);
  let stopping = false;
  const stop = () => {
    stopping = true;
    app.kill();
    mcp.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  line();
  log(`Faktura ${VERSION} is running.`);
  log('');
  log(`  Open:     ${url}`);
  log(`  Data:     ${config.dataDir}   (app.db + files/ — back this folder up)`);
  log(`  Config:   ${configPath}  (private; holds the secrets)`);
  log(`  PDF:      ${hasChromium ? 'Chromium ready' : 'Chromium NOT downloaded — issuing is disabled until you start again and download it'}`);
  log('');
  log('AI / MCP access — put one of these in your MCP client config (Claude Code, Claude Desktop, …):');
  log(`  { "mcpServers": { "kvit": { "type": "http", "url": "http://127.0.0.1:${config.mcpPort}/mcp" } } }`);
  log(`  { "mcpServers": { "kvit": { "command": ${JSON.stringify(process.execPath)}, "args": ["--mcp-stdio", "--config", ${JSON.stringify(configPath)}] } } }`);
  log('');
  log('Stop with Ctrl+C. Updating: replace this binary with a newer one and start it; your data is kept, and the');
  log(`database is copied to ${path.join(config.dataDir, 'backups')} before any schema change.`);
  line();

  void mcp.exited.then((code) => {
    if (code !== 0 && !stopping) log(`MCP server exited with code ${code} (port ${config.mcpPort} in use?). The app keeps running; AI access is unavailable.`);
  });
  setTimeout(() => pruneOldRuntimes(base), 30_000).unref?.();
  const appCode = await app.exited;
  stop();
  process.exit(appCode ?? 0);
}

main().catch((e) => {
  log(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
