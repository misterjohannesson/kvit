/**
 * Architecture guard: the MCP codebase never touches the database. Grep-level
 * check over the whole mcp/ tree (except node_modules and dist) for any database-driver
 * import, ORM import or database file path. Patterns are assembled from pieces
 * so this file does not trip its own check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === 'node_modules' || d.name === 'dist' || d.name.startsWith('.')) return [];
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : [p];
  });
}

describe('no database access from the MCP', () => {
  it('the mcp/ tree contains no database-driver import, ORM import or database file path', () => {
    const forbidden = [
      new RegExp(['better', 'sqlite3'].join('-'), 'i'),
      new RegExp(['node', 'sqlite'].join(':'), 'i'),
      new RegExp(`from ['"]${'sq' + 'lite'}`, 'i'),
      new RegExp('dri' + 'zzle', 'i'),
      new RegExp(['app', 'db'].join('\\.'), 'i'),
      new RegExp('/da' + 'ta/')
    ];
    const targets = files(path.resolve('.')).filter((f) => /\.(ts|mts|mjs|js|json|md)$/.test(f));
    expect(targets.length).toBeGreaterThan(5);
    for (const f of targets) {
      const text = fs.readFileSync(f, 'utf8');
      for (const re of forbidden) expect(text, `${path.relative('.', f)} matches ${re}`).not.toMatch(re);
    }
    // Only GET and POST exist in the client: no delete or edit path at all.
    const client = fs.readFileSync(path.resolve('src/client.ts'), 'utf8');
    expect(client).not.toMatch(/'PUT'|'DELETE'|'PATCH'/);
  });
});
