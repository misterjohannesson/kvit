import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

describe('settings', () => {
  it('only lets next_invoice_number move upward', async () => {
    const s = await c.json<Record<string, string>>('GET', '/api/settings');
    const current = Number(s.data.next_invoice_number);
    const down = await c.json<{ error: string }>('PUT', '/api/settings', { next_invoice_number: current - 1 });
    expect(down.status).toBe(400);
    const same = await c.json<Record<string, string>>('PUT', '/api/settings', { next_invoice_number: current });
    expect(same.status).toBe(200);
    expect(Number(same.data.next_invoice_number)).toBe(current);
    const up = await c.json<Record<string, string>>('PUT', '/api/settings', { next_invoice_number: current + 5 });
    expect(up.status).toBe(200);
    expect(Number(up.data.next_invoice_number)).toBe(current + 5);
  });

  it('validates CVR', async () => {
    const r = await c.json('PUT', '/api/settings', { company_cvr: 'abc' });
    expect(r.status).toBe(400);
  });
});
