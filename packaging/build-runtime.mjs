/**
 * Stage the self-contained runtime tree the standalone binary carries:
 *
 *   build/                 the SvelteKit adapter-node output (npm run build)
 *   mcp/dist, mcp/node_modules   the MCP server and its production deps
 *   node_modules/          the app's PRODUCTION dependencies only (better-sqlite3
 *                          ships N-API prebuilds for every target platform)
 *   drizzle/               migrations
 *   tokens.css style.md example.html   the design authority (asserted at startup)
 *   package.json           type: module marker
 *
 * and pack it as packaging/stage/runtime.tar.gz, which build-binaries.mjs embeds.
 * Bun is the runtime inside the binary: it runs this tree exactly as Node does.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'tar';
import { gitVersion } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, 'packaging', 'stage');
const TREE = path.join(STAGE, 'runtime');

function sh(cmd, cwd = ROOT) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** Absolute paths of production dependencies, transitively (npm's own resolution). */
function prodDependencyDirs(cwd) {
  const out = sh('npm ls --omit=dev --all --parseable --long=false', cwd).split(/\r?\n/).filter(Boolean);
  return out.filter((p) => path.resolve(p) !== path.resolve(cwd));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true, filter: (p) => !p.endsWith('.map') });
}

export function buildRuntime() {
  const version = gitVersion();
  if (!fs.existsSync(path.join(ROOT, 'build', 'index.js'))) throw new Error('App build missing: run `npm run build` first');
  if (!fs.existsSync(path.join(ROOT, 'mcp', 'dist', 'http.js'))) throw new Error('MCP build missing: run `npm --prefix mcp run build` first');

  fs.rmSync(TREE, { recursive: true, force: true });
  fs.mkdirSync(TREE, { recursive: true });

  copyDir(path.join(ROOT, 'build'), path.join(TREE, 'build'));
  copyDir(path.join(ROOT, 'drizzle'), path.join(TREE, 'drizzle'));
  for (const f of ['tokens.css', 'style.md', 'example.html']) fs.copyFileSync(path.join(ROOT, f), path.join(TREE, f));
  fs.writeFileSync(path.join(TREE, 'package.json'), JSON.stringify({ name: 'faktura-runtime', version, type: 'module', private: true }, null, 2));

  // App production dependencies (npm ls resolves nested/hoisted layout for us).
  // Build-time-only packages that npm still lists under production deps (via @sveltejs/kit): never loaded by the
  // adapter-node output, and they carry large platform binaries.
  const BUILD_ONLY = /^node_modules[\\/](@esbuild|esbuild|@rolldown|rolldown|@oxc-project|@rollup|rollup|vite|lightningcss.*|@types)([\\/]|$)/;
  const SVELTE_PLUGIN = /^node_modules[\\/]@sveltejs[\\/](vite-plugin-svelte|acorn-typescript)([\\/]|$)/;
  for (const dir of prodDependencyDirs(ROOT)) {
    const rel = path.relative(ROOT, dir);
    if (!rel.startsWith('node_modules')) continue;
    if (BUILD_ONLY.test(rel) || SVELTE_PLUGIN.test(rel)) continue;
    copyDir(dir, path.join(TREE, rel));
  }
  // The fonts embedded in PDFs are read from node_modules/@fontsource at runtime (see src/lib/server/assets.ts).
  for (const f of ['@fontsource/archivo', '@fontsource/ibm-plex-mono', '@sveltejs/kit', 'svelte', 'esm-env', 'cookie', 'set-cookie-parser', 'devalue', 'kleur', 'sade', 'mrmime', '@polka/url', 'sirv', 'totalist']) {
    if (fs.existsSync(path.join(ROOT, 'node_modules', f))) copyDir(path.join(ROOT, 'node_modules', f), path.join(TREE, 'node_modules', f));
  }

  // MCP server: dist + its production deps, under mcp/ so `node mcp/dist/http.js` works as in Docker.
  copyDir(path.join(ROOT, 'mcp', 'dist'), path.join(TREE, 'mcp', 'dist'));
  fs.copyFileSync(path.join(ROOT, 'mcp', 'package.json'), path.join(TREE, 'mcp', 'package.json'));
  for (const dir of prodDependencyDirs(path.join(ROOT, 'mcp'))) {
    const rel = path.relative(path.join(ROOT, 'mcp'), dir);
    if (!rel.startsWith('node_modules')) continue;
    copyDir(dir, path.join(TREE, 'mcp', rel));
  }

  // Trim what no runtime needs to keep the binary small: package-top-level docs/tests directories and typings.
  // LICENSE files stay (redistribution requires the notices); nothing below a package's top level is touched
  // except .d.ts files, so packages that load a nested `test` or `docs` folder at runtime keep working.
  const topLevelJunk = /^(README(\.md)?|CHANGELOG(\.md)?|\.github|test|tests|__tests__|docs|tsconfig\.json)$/i;
  const typings = /\.d\.[mc]?ts$/i;
  const pruneTypings = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) pruneTypings(p);
      else if (typings.test(e.name)) fs.rmSync(p, { force: true });
    }
  };
  const prunePackages = (nm) => {
    if (!fs.existsSync(nm)) return;
    for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const pkgDirs = e.name.startsWith('@') ? fs.readdirSync(path.join(nm, e.name)).map((n) => path.join(nm, e.name, n)) : [path.join(nm, e.name)];
      for (const pkg of pkgDirs) {
        if (!fs.statSync(pkg).isDirectory()) continue;
        for (const f of fs.readdirSync(pkg)) if (topLevelJunk.test(f)) fs.rmSync(path.join(pkg, f), { recursive: true, force: true });
        const nested = path.join(pkg, 'node_modules');
        if (fs.existsSync(nested)) prunePackages(nested);
      }
    }
    pruneTypings(nm);
  };
  prunePackages(path.join(TREE, 'node_modules'));
  prunePackages(path.join(TREE, 'mcp', 'node_modules'));

  fs.writeFileSync(path.join(TREE, 'VERSION'), version + '\n');
  const tarball = path.join(STAGE, 'runtime.tar.gz');
  return create({ gzip: true, cwd: TREE, file: tarball, portable: true }, ['.']).then(() => {
    const size = fs.statSync(tarball).size;
    console.log(`runtime ${version}: ${TREE} -> ${tarball} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    return { tarball, version };
  });
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('packaging/build-runtime.mjs')) {
  buildRuntime().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
