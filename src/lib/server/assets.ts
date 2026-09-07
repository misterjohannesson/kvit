import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './env';

export const DESIGN_ASSETS = ['tokens.css', 'style.md', 'example.html'] as const;

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
