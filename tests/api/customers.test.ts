import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

describe('customers', () => {
  it('validates input', async () => {
    const r = await c.json<{ error: string }>('POST', '/api/customers', { name: '', address: 'x', zip: '1', city: 'y' });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain('Navn');
    const bad = await c.json<{ error: string }>('POST', '/api/customers', {
      name: 'A', address: 'x', zip: '1', city: 'y', cvr: '123'
    });
    expect(bad.status).toBe(400);
  });

  it('creates, updates and refuses to delete a customer with invoices', async () => {
    const created = await c.json<{ id: number; country: string }>('POST', '/api/customers', {
      name: 'Kunde X', address: 'Vej 2', zip: '8000', city: 'Aarhus C', email: 'x@y.dk'
    });
    expect(created.status).toBe(201);
    expect(created.data.country).toBe('DK');
    const upd = await c.json<{ name: string }>('PUT', `/api/customers/${created.data.id}`, {
      name: 'Kunde X ApS', address: 'Vej 2', zip: '8000', city: 'Aarhus C', email: ''
    });
    expect(upd.status).toBe(200);
    expect(upd.data.name).toBe('Kunde X ApS');

    const draft = await c.json<{ id: number }>('POST', '/api/invoices', { customerId: created.data.id });
    expect(draft.status).toBe(201);
    expect((await c.json('DELETE', `/api/customers/${created.data.id}`)).status).toBe(409);
    expect((await c.json('DELETE', `/api/invoices/${draft.data.id}`)).status).toBe(200);
    expect((await c.json('DELETE', `/api/customers/${created.data.id}`)).status).toBe(200);
    expect((await c.json('GET', `/api/customers/${created.data.id}`)).status).toBe(404);
  });
});
