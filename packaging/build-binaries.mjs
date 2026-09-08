/**
 * Compile the standalone binaries with Bun:
 *   dist/faktura-linux-x64-<version>, dist/faktura-darwin-arm64-<version>, dist/faktura-windows-x64-<version>.exe
 * Each embeds packaging/stage/runtime.tar.gz (from build-runtime.mjs). Targets can be
 * limited with --targets linux-x64,darwin-arm64.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRuntime } from './build-runtime.mjs';
import { gitVersion } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, 'packaging', 'stage');

export const TARGETS = {
  'linux-x64': { bun: 'bun-linux-x64', ext: '' },
  'darwin-arm64': { bun: 'bun-darwin-arm64', ext: '' },
  'windows-x64': { bun: 'bun-windows-x64', ext: '.exe' }
};

export function binaryName(target, version) {
  return `faktura-${target}-${version}${TARGETS[target].ext}`;
}

export async function buildBinaries({ targets = Object.keys(TARGETS), reuseRuntime = false, outDir = path.join(ROOT, 'dist') } = {}) {
  const version = gitVersion();
  if (!reuseRuntime || !fs.existsSync(path.join(STAGE, 'runtime.tar.gz'))) await buildRuntime();
  // The tarball's own VERSION must match what is stamped on the binary (stale --reuse-runtime is refused).
  const inner = fs.existsSync(path.join(STAGE, 'runtime', 'VERSION')) ? fs.readFileSync(path.join(STAGE, 'runtime', 'VERSION'), 'utf8').trim() : version;
  if (inner !== version) throw new Error(`Staged runtime is ${inner} but HEAD is ${version}; rebuild without --reuse-runtime`);
  fs.writeFileSync(path.join(STAGE, 'VERSION'), version);
  fs.mkdirSync(outDir, { recursive: true });
  const built = [];
  for (const t of targets) {
    const spec = TARGETS[t];
    if (!spec) throw new Error(`Unknown target ${t}`);
    const outfile = path.join(outDir, binaryName(t, version));
    console.log(`bun build --compile --target=${spec.bun} -> ${outfile}`);
    // On Windows `bun` is a .cmd shim, so a shell is needed; quote every argument ourselves.
    const bunArgs = ['build', 'packaging/launcher.ts', '--compile', `--target=${spec.bun}`, '--outfile', outfile];
    if (process.platform === 'win32') execFileSync(`bun ${bunArgs.map((a) => `"${a}"`).join(' ')}`, { cwd: ROOT, stdio: 'inherit', shell: true });
    else execFileSync('bun', bunArgs, { cwd: ROOT, stdio: 'inherit' });
    built.push(outfile);
  }
  return { version, built };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('packaging/build-binaries.mjs')) {
  const i = process.argv.indexOf('--targets');
  const targets = i >= 0 ? process.argv[i + 1].split(',') : undefined;
  buildBinaries({ targets, reuseRuntime: process.argv.includes('--reuse-runtime') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
