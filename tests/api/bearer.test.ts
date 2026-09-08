/**
 * The MCP path into the app: bearer token on the JSON API, actor 'api' in the
 * audit trail, the audit read endpoint, invoice lookup by number, one-step
 * reconciliation and draft creation with lines in one request.
 */
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { Client, loggedIn } from './client';

type Inv = { id: number; invoiceNumber: number | null; status: string; paidDate: string | null; dueDate: string; totalOre: number; lines: unknown[] };
type Audit = { id: number; entity: string; entityId: number; action: string; actor: string; detail: Record<string, unknown> };
type Balance = { likviderOre: number; lastReconciliation: { date: string; actualOre: number; differenceOre: number; bookedMovementId: number | null } | null };

let api: Client;
let ui: Client;

beforeAll(async () => {
  api = Client.withToken(inject('apiToken'));
  ui = await loggedIn();
});

describe('bearer token', () => {
  it('a valid token reads and writes without a session; a wrong or missing one is 401 and mutates nothing', async () => {
    expect((await api.json('GET', '/api/invoices')).status).toBe(200);
    const before = (await api.json<unknown[]>('GET', '/api/cash-movements')).data.length;
    const wrong = Client.withToken('not-the-token');
    expect((await wrong.json('GET', '/api/invoices')).status).toBe(401);
    expect((await wrong.json('POST', '/api/cash-movements', { date: '2026-09-08', description: 'x', amountOre: -100, kind: 'other' })).status).toBe(401);
    const none = new Client();
    expect((await none.json('POST', '/api/cash-movements', { date: '2026-09-08', description: 'x', amountOre: -100, kind: 'other' })).status).toBe(401);
    expect((await api.json<unknown[]>('GET', '/api/cash-movements')).data.length).toBe(before);
    // Bearer is only honoured on the JSON API; pages still need the session.
    expect((await Client.withToken(inject('apiToken')).raw('GET', '/fakturaer', undefined, { accept: 'text/html' })).status).toBe(303);
  });

  it('a wrong bearer header is refused even when a valid session cookie is present', async () => {
    const both = await loggedIn();
    both.token = 'wrong';
    // token wins over cookie in Client.raw, so send both by hand
    const r = await fetch(both.base + '/api/invoices', { headers: { cookie: ui.cookie, authorization: 'Bearer wrong' } });
    expect(r.status).toBe(401);
    // A malformed or non-Bearer Authorization header is just as decisive: no cookie fallback.
    for (const header of ['Basic dXNlcjpwdw==', 'Bearer', 'Token abc', 'Bearer a b']) {
      const m = await fetch(both.base + '/api/invoices', { headers: { cookie: ui.cookie, authorization: header } });
      expect(m.status, header).toBe(401);
    }
  });

  it('a malformed issueDate without dueDate on draft creation is a 400, not a 500', async () => {
    const customers = (await api.json<{ id: number }[]>('GET', '/api/customers')).data;
    for (const issueDate of ['abc', '2026-13-01', 20260908]) {
      const r = await api.json<{ error: string }>('POST', '/api/invoices', { customerId: customers[0].id, issueDate, lines: [] });
      expect(r.status, String(issueDate)).toBe(400);
    }
    // null means 'default': today's date, so the draft is created.
    const nul = await api.json<{ id: number; issueDate: string }>('POST', '/api/invoices', { customerId: customers[0].id, issueDate: null, lines: [] });
    expect(nul.status).toBe(201);
    expect(nul.data.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await ui.json('DELETE', `/api/invoices/${nul.data.id}`);
  });

  it('writes through the token are audited as actor "api", UI writes as "ui"', async () => {
    const mv = await api.json<{ id: number }>('POST', '/api/cash-movements', { date: '2026-09-08', description: 'MCP-test', amountOre: -1234, kind: 'other' });
    expect(mv.status).toBe(201);
    const trail = (await api.json<Audit[]>('GET', `/api/audit?entity=cash_movement&entityId=${mv.data.id}`)).data;
    expect(trail.length).toBe(1);
    expect(trail[0].actor).toBe('api');
    expect(trail[0].action).toBe('create');
    expect(trail[0].detail.amountOre).toBe(-1234);

    const uiMv = await ui.json<{ id: number }>('POST', '/api/cash-movements', { date: '2026-09-08', description: 'UI-test', amountOre: -1, kind: 'other' });
    const uiTrail = (await ui.json<Audit[]>('GET', `/api/audit?entity=cash_movement&entityId=${uiMv.data.id}`)).data;
    expect(uiTrail[0].actor).toBe('ui');

    const onlyApi = (await api.json<Audit[]>('GET', '/api/audit?actor=api&limit=5')).data;
    expect(onlyApi.every((a) => a.actor === 'api')).toBe(true);
    expect((await api.json('GET', '/api/audit?actor=bogus')).status).toBe(400);
  });
});

describe('endpoints added for the MCP', () => {
  it('looks an invoice up by number', async () => {
    const r = await api.json<Inv>('GET', '/api/invoices/number/1001');
    expect(r.status).toBe(200);
    expect(r.data.invoiceNumber).toBe(1001);
    expect(r.data.lines.length).toBe(2);
    expect((await api.json('GET', '/api/invoices/number/999999')).status).toBe(404);
  });

  it('reconciles in one step: books exactly the delta, then nothing when the figure agrees, and records both', async () => {
    const b0 = (await api.json<Balance>('GET', '/api/finance?view=balance')).data;
    const wrongFigure = b0.likviderOre - 50_000;
    const r1 = await api.json<{ likviderOre: number; differenceOre: number; movement: { id: number; amountOre: number; kind: string } | null }>('POST', '/api/balance/reconcile', { actualOre: wrongFigure, date: '2026-09-08' });
    expect(r1.status).toBe(200);
    expect(r1.data.likviderOre).toBe(b0.likviderOre);
    expect(r1.data.differenceOre).toBe(-50_000);
    expect(r1.data.movement?.amountOre).toBe(-50_000);
    expect(r1.data.movement?.kind).toBe('correction');
    const b1 = (await api.json<Balance>('GET', '/api/finance?view=balance')).data;
    expect(b1.likviderOre).toBe(wrongFigure);
    expect(b1.lastReconciliation?.differenceOre).toBe(-50_000);
    expect(b1.lastReconciliation?.bookedMovementId).toBe(r1.data.movement!.id);

    const r2 = await api.json<{ differenceOre: number; movement: unknown }>('POST', '/api/balance/reconcile', { actualOre: wrongFigure });
    expect(r2.status).toBe(200);
    expect(r2.data.differenceOre).toBe(0);
    expect(r2.data.movement).toBeNull();
    const b2 = (await api.json<Balance>('GET', '/api/finance?view=balance')).data;
    expect(b2.likviderOre).toBe(wrongFigure);
    expect(b2.lastReconciliation?.differenceOre).toBe(0);
    expect(b2.lastReconciliation?.bookedMovementId).toBeNull();
    const reconciles = (await api.json<Audit[]>('GET', '/api/audit?entity=balance&action=reconcile')).data;
    expect(reconciles.length).toBeGreaterThanOrEqual(2);
    expect(reconciles[0].actor).toBe('api');

    // Put Likvider back so later files see the seed figure (the fix is itself a logged correction).
    await api.json('POST', '/api/balance/reconcile', { actualOre: b0.likviderOre });
    expect((await api.json<Balance>('GET', '/api/finance?view=balance')).data.likviderOre).toBe(b0.likviderOre);
    expect((await api.json('POST', '/api/balance/reconcile', { actualOre: 1.5 })).status).toBe(400);
  });

  it('creates a draft with lines in one request and leaves nothing behind when the lines are invalid', async () => {
    const customers = (await api.json<{ id: number }[]>('GET', '/api/customers')).data;
    const countBefore = (await api.json<Inv[]>('GET', '/api/invoices')).data.length;
    const bad = await api.json<{ error: string }>('POST', '/api/invoices', {
      customerId: customers[0].id,
      lines: [{ description: '', quantity: 0, unit: '', unitPriceOre: 100 }]
    });
    expect(bad.status).toBe(400);
    expect((await api.json<Inv[]>('GET', '/api/invoices')).data.length).toBe(countBefore);

    const ok = await api.json<Inv>('POST', '/api/invoices', {
      customerId: customers[0].id,
      dueDate: '2026-10-15',
      lines: [{ description: 'Rådgivning', quantity: 2, unit: 'time', unitPriceOre: 100000 }]
    });
    expect(ok.status).toBe(201);
    expect(ok.data.status).toBe('draft');
    expect(ok.data.invoiceNumber).toBeNull();
    expect(ok.data.dueDate).toBe('2026-10-15');
    expect(ok.data.totalOre).toBe(250000);
    expect(ok.data.lines.length).toBe(1);
    const trail = (await api.json<Audit[]>('GET', `/api/audit?entity=invoice&entityId=${ok.data.id}`)).data;
    expect(trail.map((a) => a.action).sort()).toEqual(['create', 'update']);
    expect(trail.every((a) => a.actor === 'api')).toBe(true);
    // The MCP never issues; the token can still not do it either way through the app's rules (a draft with no company details set is refused) - but the point here is only that the draft exists for the owner to issue in the UI.
    await ui.json('DELETE', `/api/invoices/${ok.data.id}`);
  });
});
