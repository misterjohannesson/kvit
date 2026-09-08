/**
 * `npm run release`: everything release.yml attaches, built locally the same way CI does
 * (the workflow calls this script; there is no second copy of the logic).
 *
 *   dist/install.sh, dist/install.ps1        installers with the image name filled in
 *   dist/faktura-<target>-<version>[.exe]    the three standalone binaries
 *   dist/SHA256SUMS                          checksums of everything above
 *   dist/RELEASE_NOTES.md                    release-template.md rendered with version + commits
 *   dist/VERSION
 *
 * Env: RELEASE_IMAGE (default ghcr.io/kvit-app/faktura), RELEASE_TARGETS (comma list, default all),
 *      RELEASE_SKIP_BUILD=1 to reuse existing build/ and mcp/dist.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBinaries, TARGETS } from './build-binaries.mjs';
import { gitVersion } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

function sh(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function commitList(version) {
  try {
    const tags = execSync('git tag --sort=-v:refname', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    const current = tags.find((t) => t.replace(/^v/, '') === version);
    const previous = current ? tags[tags.indexOf(current) + 1] : tags[0];
    const range = previous ? `${previous}..HEAD` : 'HEAD';
    const out = execSync(`git log --no-merges --pretty=format:"- %s (%h)" ${range}`, { cwd: ROOT, encoding: 'utf8' }).trim();
    return out || '- (no changes listed)';
  } catch {
    return '- (commit list unavailable)';
  }
}

export function renderReleaseNotes(version, image) {
  const template = fs.readFileSync(path.join(ROOT, 'release-template.md'), 'utf8');
  return template.replaceAll('{{version}}', version).replaceAll('{{image}}', image).replaceAll('{{commits}}', commitList(version));
}

export async function release() {
  const version = gitVersion();
  const image = process.env.RELEASE_IMAGE ?? 'ghcr.io/kvit-app/faktura';
  const targets = process.env.RELEASE_TARGETS ? process.env.RELEASE_TARGETS.split(',') : Object.keys(TARGETS);
  console.log(`Release ${version} (image ${image}, targets ${targets.join(', ')})`);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  if (process.env.RELEASE_SKIP_BUILD !== '1') {
    sh('npm run build');
    sh('npm --prefix mcp run build');
  }
  await buildBinaries({ targets, outDir: DIST });

  for (const f of ['install.sh', 'install.ps1']) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replaceAll('__IMAGE__', `${image}:latest`);
    fs.writeFileSync(path.join(DIST, f), text, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(DIST, 'VERSION'), version + '\n');
  fs.writeFileSync(path.join(DIST, 'RELEASE_NOTES.md'), renderReleaseNotes(version, image));

  const sums = fs
    .readdirSync(DIST)
    .filter((f) => f !== 'SHA256SUMS' && f !== 'RELEASE_NOTES.md' && f !== 'VERSION')
    .sort()
    .map((f) => `${createHash('sha256').update(fs.readFileSync(path.join(DIST, f))).digest('hex')}  ${f}`);
  fs.writeFileSync(path.join(DIST, 'SHA256SUMS'), sums.join('\n') + '\n');
  console.log(fs.readFileSync(path.join(DIST, 'SHA256SUMS'), 'utf8'));
  return { version, dist: DIST };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('packaging/release.mjs')) {
  release().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
