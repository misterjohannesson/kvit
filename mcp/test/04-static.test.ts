/**
 * Architecture guard: the MCP codebase never touches the database. Grep-level
 * check over src/ and package.json for any SQLite import or database path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

describe('no database access from the MCP', () => {
  it('src/ and package.json contain no sqlite import, drizzle import or app.db path', () => {
    const targets = [...files(path.resolve('src')), path.resolve('package.json')];
    const forbidden = [/better-sqlite3/i, /from ['"]sqlite/i, /node:sqlite/i, /drizzle/i, /app\.db/i, /\/data\//];
    for (const f of targets) {
      const text = fs.readFileSync(f, 'utf8');
      for (const re of forbidden) expect(text, `${path.basename(f)} matches ${re}`).not.toMatch(re);
    }
  });
});
