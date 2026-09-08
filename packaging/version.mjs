// Version from git tags (semver, `v1.2.3` -> `1.2.3`); a commit without a tag becomes `0.0.0-dev.<sha>`.
import { execSync } from 'node:child_process';

export function gitVersion() {
  const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const exact = run('git describe --tags --exact-match');
    if (/^v?\d+\.\d+\.\d+/.test(exact)) return exact.replace(/^v/, '');
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
