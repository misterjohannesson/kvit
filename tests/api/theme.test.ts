import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

/** Colour theme (style.md §9): a per-browser cookie that hooks.server.ts turns into data-theme on <html>. */
describe('theme', () => {
  async function pageHtml(path: string, cookie: string): Promise<string> {
    const r = await c.raw('GET', path, undefined, { cookie, accept: 'text/html' });
    expect(r.status).toBe(200);
    return r.text();
  }

  it('defaults to light and marks the preference on <html>', async () => {
    const html = await pageHtml('/', c.cookie);
    expect(html).toMatch(/<html lang="da" data-theme="light" data-theme-pref="light">/);
  });

  it('sets the cookie, bounces back and themes every page including login', async () => {
    const form = new FormData();
    form.set('value', 'dark');
    form.set('back', '/kunder');
    const r = await c.raw('POST', '/theme', form);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/kunder');
    const sc = r.headers.get('set-cookie') ?? '';
    expect(sc).toMatch(/faktura_theme=dark/);
    expect(sc).toMatch(/HttpOnly/);

    const html = await pageHtml('/kunder', `${c.cookie}; faktura_theme=dark`);
    expect(html).toMatch(/<html lang="da" data-theme="dark" data-theme-pref="dark">/);
    // The picker shows the current choice.
    expect(html).toMatch(/value="dark" aria-pressed="true"/);

    // The login page sits outside the app layout but is themed by the same hook.
    const anon = new Client();
    const login = await anon.raw('GET', '/login', undefined, { cookie: 'faktura_theme=solarized', accept: 'text/html' });
    expect(login.status).toBe(200);
    expect(await login.text()).toMatch(/<html lang="da" data-theme="solarized" data-theme-pref="solarized">/);
  });

  it('renders auto as light with the OS-following script in place', async () => {
    const html = await pageHtml('/', `${c.cookie}; faktura_theme=auto`);
    expect(html).toMatch(/<html lang="da" data-theme="light" data-theme-pref="auto">/);
    expect(html).toContain("matchMedia('(prefers-color-scheme: dark)')");
    // The script must carry the CSP nonce, or script-src 'self' blocks it.
    expect(html).toMatch(/<script nonce="[^"]+">\s*\/\/ Theme "auto"/);
  });

  it('falls back to light on an unknown value and refuses an off-site redirect', async () => {
    const form = new FormData();
    form.set('value', 'hotdog-stand');
    form.set('back', '//evil.example');
    const r = await c.raw('POST', '/theme', form);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/');
    expect(r.headers.get('set-cookie')).toMatch(/faktura_theme=light/);

    const html = await pageHtml('/', `${c.cookie}; faktura_theme=hotdog-stand`);
    expect(html).toMatch(/data-theme="light" data-theme-pref="light"/);
  });
});
