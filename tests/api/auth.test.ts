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
    for (const path of ['/', '/fakturaer', '/udgifter', '/kunder', '/indstillinger']) {
      const p = await c.raw('GET', path);
      expect(p.status, path).toBe(200);
      expect(await p.text()).toContain('<html');
    }
  });

  it('logs out', async () => {
    const c = new Client();
    await c.login();
    const r = await c.raw('POST', '/logout');
    expect(r.status).toBe(303);
    expect(r.headers.get('set-cookie')).toMatch(/faktura_session=;/);
  });
});
