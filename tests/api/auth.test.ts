import { describe, expect, inject, it } from 'vitest';
import { Client } from './client';

describe('single-password login', () => {
  it('redirects unauthenticated page requests to /login and rejects API calls with 401', async () => {
    const base = inject('baseUrl');
    const page = await fetch(base + '/', { redirect: 'manual' });
    expect(page.status).toBe(303);
    expect(page.headers.get('location')).toBe('/login');
    const api = await fetch(base + '/api/invoices');
    expect(api.status).toBe(401);
  });

  it('rejects a wrong password and sets no cookie', async () => {
    const c = new Client();
    const r = await c.login('forkert');
    expect(r.status).toBe(401);
    expect(c.cookie).toBe('');
  });

  it('accepts APP_PASSWORD, sets an HttpOnly cookie and lets every screen render', async () => {
    const c = new Client();
    const r = await c.login();
    expect(r.status).toBe(303);
    expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/);
    for (const path of ['/', '/fakturaer', '/udgifter', '/moms', '/resultat', '/cashflow', '/balance', '/kunder', '/indstillinger', '/eksport']) {
      const p = await c.raw('GET', path);
      expect(p.status, path).toBe(200);
      expect(await p.text()).toContain('<html');
    }
  });

  it('refuses mutating requests whose Origin does not match the host (CSRF)', async () => {
    const c = new Client();
    await c.login();
    const r = await c.raw('POST', '/api/customers', { name: 'Evil' }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    const nul = await c.raw('POST', '/api/customers', { name: 'Evil' }, { origin: 'null' });
    expect(nul.status).toBe(403);
    const ok = await c.raw('GET', '/api/customers', undefined, { origin: 'https://evil.example' });
    expect(ok.status).toBe(200);
  });

  it('locks an address for 30 s after five wrong passwords', async () => {
    const base = inject('baseUrl');
    const attempt = (password: string) =>
      fetch(base + '/login', {
        method: 'POST',
        body: new URLSearchParams({ password }),
        redirect: 'manual',
        headers: { accept: 'text/html', origin: base, 'x-forwarded-for': '10.99.0.7' }
      });
    for (let i = 0; i < 5; i++) expect((await attempt('forkert')).status).toBe(401);
    expect((await attempt('forkert')).status).toBe(429);
    // Even the right password is refused while locked; other addresses are unaffected.
    expect((await attempt(inject('password'))).status).toBe(429);
    const other = await fetch(base + '/login', {
      method: 'POST',
      body: new URLSearchParams({ password: inject('password') }),
      redirect: 'manual',
      headers: { accept: 'text/html', origin: base, 'x-forwarded-for': '10.99.0.8' }
    });
    expect(other.status).toBe(303);
  });

  it('rejects an unparsable JSON body on issue/credit instead of ignoring it', async () => {
    const c = new Client();
    await c.login();
    const r = await c.raw('POST', '/api/invoices/1/issue', undefined, { 'content-type': 'application/json' });
    expect(r.status).not.toBe(400); // empty body is fine (no expectedNumber) -> 409/404, not a parse error
    const bad = await fetch(inject('baseUrl') + '/api/invoices/1/issue', {
      method: 'POST',
      headers: { cookie: c.cookie, 'content-type': 'application/json' },
      body: '{not json'
    });
    expect(bad.status).toBe(400);
  });

  it('logs out', async () => {
    const c = new Client();
    await c.login();
    const r = await c.raw('POST', '/logout');
    expect(r.status).toBe(303);
    expect(r.headers.get('set-cookie')).toMatch(/faktura_session=;/);
  });
});
