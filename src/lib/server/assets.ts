import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './env';

const DESIGN_ASSETS = ['tokens.css', 'style.md', 'example.html'] as const;

/** The three design files are mandatory. Halt with an error if any is missing. */
export function assertDesignAssets(): void {
  const missing = DESIGN_ASSETS.filter((f) => !fs.existsSync(path.join(PROJECT_ROOT, f)));
  if (missing.length > 0) {
    throw new Error(
      `Design assets missing in ${PROJECT_ROOT}: ${missing.join(', ')}. ` +
        'tokens.css, style.md and example.html must exist in the project root.'
    );
  }
}

let tokensCache: string | null = null;
let fontFaceCache: string | null = null;

const FONT_FILES: { family: string; weight: number; pkg: string; file: string }[] = [
  { family: 'Archivo', weight: 400, pkg: '@fontsource/archivo', file: 'archivo-latin-400-normal.woff2' },
  { family: 'Archivo', weight: 500, pkg: '@fontsource/archivo', file: 'archivo-latin-500-normal.woff2' },
  { family: 'Archivo', weight: 600, pkg: '@fontsource/archivo', file: 'archivo-latin-600-normal.woff2' },
  { family: 'IBM Plex Mono', weight: 400, pkg: '@fontsource/ibm-plex-mono', file: 'ibm-plex-mono-latin-400-normal.woff2' },
  { family: 'IBM Plex Mono', weight: 500, pkg: '@fontsource/ibm-plex-mono', file: 'ibm-plex-mono-latin-500-normal.woff2' }
];

/**
 * @font-face rules with the self-hosted woff2 files inlined as data URIs, so
 * the PDF renderer (a blank Chromium page fed HTML) uses the same Archivo and
 * IBM Plex Mono as the screen. Read once; ~120 kB in total.
 */
export function fontFaceCss(): string {
  if (fontFaceCache === null) {
    fontFaceCache = FONT_FILES.map((f) => {
      const abs = path.join(PROJECT_ROOT, 'node_modules', f.pkg, 'files', f.file);
      if (!fs.existsSync(abs)) throw new Error(`Font file missing: ${abs} (run npm install)`);
      const b64 = fs.readFileSync(abs).toString('base64');
      return `@font-face { font-family: "${f.family}"; font-style: normal; font-weight: ${f.weight}; font-display: block; src: url(data:font/woff2;base64,${b64}) format("woff2"); }`;
    }).join('\n');
  }
  return fontFaceCache;
}

export function readTokensCss(): string {
  if (tokensCache === null) {
    assertDesignAssets();
    tokensCache = fs.readFileSync(path.join(PROJECT_ROOT, 'tokens.css'), 'utf8');
  }
  return tokensCache;
}

/** Read a single custom property value from tokens.css (screen :root block). */
export function tokenValue(name: string): string {
  const css = readTokensCss().split('@media print')[0];
  return findToken(css, name);
}

/** Read a custom property value as re-pointed inside the @media print block. */
export function printTokenValue(name: string): string {
  const parts = readTokensCss().split('@media print');
  if (parts.length < 2) return tokenValue(name);
  try {
    return findToken(parts[1], name);
  } catch {
    return tokenValue(name);
  }
}

function findToken(css: string, name: string): string {
  const re = new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`);
  const m = css.match(re);
  if (!m) throw new Error(`Token ${name} not found in tokens.css`);
  return m[1].trim();
}
