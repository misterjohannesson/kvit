// Version from git tags (semver, `v1.2.3` -> `1.2.3`; a two-part tag like `v0.2` becomes `0.2.0`);
// a commit without a tag becomes `0.0.0-dev.<sha>`.
import { execSync } from 'node:child_process';

export function normalizeVersion(tag) {
  const m = tag.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3] ?? '0'}${m[4] ?? ''}`;
}

export function gitVersion() {
  const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    // A release tag may be the newest of several tags on HEAD; take the first that looks like a version.
    const tags = run('git tag --points-at HEAD').split(/\r?\n/).filter(Boolean);
    const v = tags.map(normalizeVersion).find(Boolean);
    if (v) return v;
  } catch {
    /* not on a tag */
  }
  let sha = 'unknown';
  try {
    sha = run('git rev-parse --short HEAD');
  } catch {
    /* no git */
  }
  return `0.0.0-dev.${sha}`;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('packaging/version.mjs')) {
  console.log(gitVersion());
}
