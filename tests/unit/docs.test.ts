/**
 * Documentation cannot silently rot: the hosting guide's disclaimer is verbatim and
 * first, its config blocks parse, the user guide covers its eight sections with real
 * screenshots, the release template says what the spec requires, the site carries no
 * version numbers, and the workflows are valid YAML that call the release script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');
const fenced = (md: string, lang: string): string[] => [...md.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]);

const DISCLAIMER =
  'Faktura is built for one user on a private network. It has a single shared password, no 2FA, no brute-force lockout, and has not been security audited. The recommended setup is VPN-only access (e.g. Tailscale). Exposing it directly to the internet is at your own risk — this guide reduces that risk, it does not remove it.';

describe('HOSTING.md', () => {
  const md = read('HOSTING.md');

  it('opens with the disclaimer, verbatim, as the first content after the title', () => {
    const body = md.replace(/^# .*\n+/, '');
    expect(body.startsWith(DISCLAIMER)).toBe(true);
  });

  it('has the five sections in order', () => {
    const idx = ['## 1. Recommended: VPN-only', '## 2. If you must go public', '## 3. Backups', '## 4. Updating'].map((h) => md.indexOf(h));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(md).toMatch(/Tailscale/);
    expect(md).toMatch(/third party/);
    // No Kubernetes or scaling *sections*: the word may only appear in prose that rules it out.
    expect(md.split('\n').filter((l) => l.startsWith('#')).join('\n')).not.toMatch(/kubernetes|\bscaling\b/i);
  });

  it('every Caddyfile block is balanced and proxies to the app on localhost', () => {
    const blocks = fenced(md, 'caddyfile');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) {
      let depth = 0;
      for (const ch of b) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
      expect(b).toMatch(/reverse_proxy 127\.0\.0\.1:3000/);
      expect(b).not.toMatch(/3333/); // the MCP port is never proxied
    }
    expect(blocks[0]).toMatch(/rate_limit/);
    expect(blocks[0]).toMatch(/path \/login/);
  });

  it('every cron block is a valid five-field crontab line with a command', () => {
    const blocks = fenced(md, 'cron');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const field = /^(\*|\d+|\*\/\d+|\d+-\d+|\d+(,\d+)+)$/;
    for (const b of blocks) {
      for (const lineText of b.split('\n').filter((l) => l.trim() && !l.startsWith('#'))) {
        const parts = lineText.trim().split(/\s+/);
        expect(parts.length).toBeGreaterThan(6);
        for (const f of parts.slice(0, 5)) expect(f, lineText).toMatch(field);
        expect(parts[5]).toBe('root');
        expect(lineText).toMatch(/rclone|restic/);
      }
    }
  });
});

describe('GUIDE.md', () => {
  const md = read('GUIDE.md');

  it('is Danish, covers the eight sections in order and embeds at least six screenshots that exist', () => {
    const heads = ['## 1. Kom i gang', '## 2. Fakturaer', '## 3. Udgifter', '## 4. Moms', '## 5. Månedsrutinen', '## 6. Budget og overblik', '## 7. AI-adgang (MCP)', '## 8. Eksport og revisor'];
    const idx = heads.map((h) => md.indexOf(h));
    expect(idx.every((i) => i > 0), JSON.stringify(idx)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    const images = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    expect(images.length).toBeGreaterThanOrEqual(6);
    for (const img of images) expect(fs.existsSync(path.resolve(img)), img).toBe(true);
    expect(md).toMatch(/kvartal|moms|faktura/i);
  });

  it('the AI section names the three forbidden actions with a rationale and gives Danish example prompts', () => {
    const ai = md.slice(md.indexOf('## 7. AI-adgang (MCP)'), md.indexOf('## 8. Eksport og revisor'));
    expect(ai).toMatch(/udstede fakturaer/i);
    expect(ai).toMatch(/oprette kreditnotaer/i);
    expect(ai).toMatch(/slette noget/i);
    expect(ai).toMatch(/hvilke fakturaer forfalder snart/i);
    expect(ai).toMatch(/hvad står jeg i banken/i);
    expect(ai).toMatch(/registrér min saldo/i);
    expect(ai).toMatch(/nummerserie|uigenkaldelig|irreversibel/i);
  });
});

describe('release-template.md', () => {
  const md = read('release-template.md');
  it('has per-OS download instructions in plain language, the one-liner, the paranoid variant and the no-data-loss sentence', () => {
    expect(md).toMatch(/\*\*Windows:\*\*[\s\S]*double-click/);
    expect(md).toMatch(/\*\*Mac[^*]*\*\*[\s\S]*faktura-darwin-arm64/);
    expect(md).toMatch(/\*\*Linux[^*]*\*\*[\s\S]*faktura-linux-x64/);
    expect(md).toMatch(/curl -fsSL https:\/\/github\.com\/OWNER\/REPO\/releases\/latest\/download\/install\.sh \| bash/);
    expect(md).toMatch(/sha256sum --check/);
    expect(md).toMatch(/\*\*Updating never deletes data\.\*\*/);
    expect(md).toMatch(/\{\{version\}\}/);
    expect(md).toMatch(/\{\{commits\}\}/);
    // The install section never mentions a terminal before the paranoid variant.
    const beforeParanoid = md.slice(0, md.indexOf('### If you prefer to inspect'));
    const windowsMac = beforeParanoid.slice(beforeParanoid.indexOf('**Windows:**'), beforeParanoid.indexOf('**Mac'));
    expect(windowsMac).not.toMatch(/terminal/i);
  });
});

describe('site/', () => {
  it('index and whitepaper exist, reference tokens.css, carry no version numbers, and index has the disclaimer and /latest/ links', () => {
    for (const f of ['site/index.html', 'site/whitepaper.html']) {
      const html = read(f);
      expect(html).toMatch(/href="\.?\/?tokens\.css"/);
      expect(html, f).not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
    }
    const index = read('site/index.html');
    expect(index).toContain('Faktura is built for one user on a private network.');
    expect(index).toMatch(/releases\/latest\/download\/install\.sh/);
    expect(index).toMatch(/releases\/latest\//);
    expect(index).toMatch(/whitepaper\.html/);
    expect(fs.existsSync(path.resolve('site/.nojekyll'))).toBe(true);
    const wp = read('site/whitepaper.html');
    expect(wp).toMatch(/@media print/);
    expect(wp).toContain('Faktura is built for one user on a private network.');
  });
});

describe('workflows', () => {
  const files = ['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/pages.yml'];
  it('parse as YAML and call the scripts instead of duplicating release logic', () => {
    for (const f of files) {
      const doc = parseYaml(read(f)) as Record<string, unknown>;
      expect(doc.jobs, f).toBeTruthy();
    }
    const release = read('.github/workflows/release.yml');
    expect(release).toMatch(/npm run release/);
    expect(release).toMatch(/SHA256SUMS/);
    expect(release).toMatch(/RELEASE_NOTES\.md/);
    expect(release).toMatch(/linux\/amd64,linux\/arm64/);
    const ci = read('.github/workflows/ci.yml');
    for (const s of ['npm run check', 'npm test', 'npm run mcp:test', 'npm run test:install', 'npm run test:docs', 'docker build']) expect(ci, s).toContain(s);
    const pages = read('.github/workflows/pages.yml');
    expect(pages).toMatch(/upload-pages-artifact/);
    expect(pages).toMatch(/deploy-pages/);
    expect(pages).toMatch(/cp tokens\.css site\//);
  });
});
