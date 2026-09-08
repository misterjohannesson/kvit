/**
 * Kontoplan round trip: download, edit, upload (form action and API), groups, archiving. Runs after the finance
 * tests (alphabetical order) and puts the kontoplan back the way it found it, so later files see the seed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

type Account = { id: number; number: number; name: string; type: 'revenue' | 'cost'; group: string; archived: boolean };

let c: Client;

async function download(): Promise<{ status: number; text: string; disposition: string | null; type: string | null }> {
  const r = await c.raw('GET', '/api/accounts/csv');
  return { status: r.status, text: (await r.text()).replace(/^﻿/, ''), disposition: r.headers.get('content-disposition'), type: r.headers.get('content-type') };
}

async function upload(text: string, opts: { prune?: boolean; viaForm?: boolean } = {}) {
  if (opts.viaForm) {
    const fd = new FormData();
    fd.set('file', new Blob(['﻿' + text], { type: 'text/csv' }), 'kontoplan.csv');
    if (opts.prune) fd.set('prune', 'on');
    const r = await c.raw('POST', '/indstillinger?/importAccounts', fd, { accept: 'text/html' });
    return { status: r.status, body: await r.text() };
  }
  // Raw text body: the client helper JSON-encodes bodies, so this goes through fetch directly.
  const res = await fetch(c.base + `/api/accounts/csv${opts.prune ? '?prune=1' : ''}`, {
    method: 'POST',
    headers: { cookie: c.cookie, 'content-type': 'text/csv; charset=utf-8' },
    body: text
  });
  return { status: res.status, body: await res.text() };
}

const accounts = async () => (await c.json<Account[]>('GET', '/api/accounts')).data;
const byNumber = async (n: number) => (await accounts()).find((a) => a.number === n)!;

let original: string;

beforeAll(async () => {
  c = await loggedIn();
  original = (await download()).text;
});

afterAll(async () => {
  // Restore: the seed's accounts as they were, and drop what this file created.
  await upload(original, { prune: true });
});

describe('kontoplan.csv download', () => {
  it('is a semicolon CSV with the five columns, one row per account, served as an attachment', async () => {
    const d = await download();
    expect(d.status).toBe(200);
    expect(d.type).toMatch(/^text\/csv/);
    expect(d.disposition).toContain('kontoplan.csv');
    const lines = d.text.trim().split('\r\n');
    expect(lines[0]).toBe('kontonr;navn;type;gruppe;arkiveret');
    expect(lines.length - 1).toBe((await accounts()).length);
    expect(lines).toContain('1000;Konsulentydelser;salg;Omsætning;nej');
    expect(lines).toContain('7500;Afskrivninger;omkostning;Afskrivninger og finansielle poster;nej');
  });
});

describe('kontoplan.csv upload', () => {
  it('renames, regroups, archives and creates in one atomic pass through the form action', async () => {
    const edited = original
      .replace('2550;Faglitteratur og abonnementer;omkostning;Administration;nej', '2550;Faglitteratur;omkostning;Personale;ja')
      .concat('2700;Telefoni;omkostning;Kontor og lokaler;nej\r\n');
    const r = await upload(edited, { viaForm: true });
    expect(r.status).toBe(200);
    expect(r.body).toContain('1 oprettet');
    expect(r.body).toContain('1 ændret');
    expect(await byNumber(2550)).toMatchObject({ name: 'Faglitteratur', group: 'Personale', archived: true });
    expect(await byNumber(2700)).toMatchObject({ name: 'Telefoni', group: 'Kontor og lokaler', type: 'cost', archived: false });
    // Archived accounts are hidden from the active list and from the MCP-facing default, but still exported.
    const active = (await c.json<Account[]>('GET', '/api/accounts?active=1&type=cost')).data;
    expect(active.some((a) => a.number === 2550)).toBe(false);
    expect((await download()).text).toContain('2550;Faglitteratur;omkostning;Personale;ja');
    // Audit: the individual changes plus one summary row.
    const audit = (await c.json<{ entity: string; action: string; detail: Record<string, unknown> }[]>('GET', '/api/audit?entity=account&limit=10')).data;
    expect(audit[0]).toMatchObject({ action: 'import', detail: { created: 1, updated: 1, deleted: 0, prune: false } });
    expect(audit.some((a) => a.action === 'create')).toBe(true);
    expect(audit.some((a) => a.action === 'update' && (a.detail as { archived?: unknown }).archived !== undefined)).toBe(true);
  });

  it('refuses a new record on an archived account but keeps an existing record editable', async () => {
    const archived = await byNumber(2550);
    const bad = await c.json<{ error: string }>('POST', '/api/expenses', {
      date: '2026-09-05', supplier: 'X', description: 'Y', accountId: archived.id, amountExVatOre: 100, vatOre: 25
    });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toContain('arkiveret');
    // An expense booked on an account that is archived afterwards can still be saved on that account
    // (the seeded Adobe voucher sits on 2000 Software og hosting).
    type Expense = { id: number; supplier: string; accountId: number; date: string; description: string; amountExVatOre: number; vatOre: number; paidDate: string | null };
    const adobe = (await c.json<Expense[]>('GET', '/api/expenses?year=2026')).data.find((e) => e.supplier.startsWith('Adobe'))!;
    const software = await byNumber(2000);
    expect(adobe.accountId).toBe(software.id);
    expect((await c.json('PUT', `/api/accounts/${software.id}`, { archived: true })).status).toBe(200);
    const edit = await c.json<{ error?: string }>('PUT', `/api/expenses/${adobe.id}`, {
      date: adobe.date, supplier: adobe.supplier, description: adobe.description, accountId: adobe.accountId, amountExVatOre: adobe.amountExVatOre, vatOre: adobe.vatOre, paidDate: adobe.paidDate
    });
    expect(edit.status, edit.data.error).toBe(200);
    // Moving another record onto the archived account is refused, and the account is offered again once un-archived.
    const other = (await c.json<Expense[]>('GET', '/api/expenses?year=2026')).data.find((e) => e.supplier.startsWith('DSB'))!;
    const move = await c.json<{ error: string }>('PUT', `/api/expenses/${other.id}`, {
      date: other.date, supplier: other.supplier, description: other.description, accountId: software.id, amountExVatOre: other.amountExVatOre, vatOre: other.vatOre, paidDate: other.paidDate
    });
    expect(move.status).toBe(400);
    expect(move.data.error).toContain('arkiveret');
    expect((await c.json('PUT', `/api/accounts/${software.id}`, { archived: 'nej' })).status).toBe(200);
    expect((await byNumber(2000)).archived).toBe(false);
  });

  it('rejects type changes, duplicates, bad rows and a missing header without touching anything', async () => {
    const before = (await download()).text;
    const cases: [string, RegExp][] = [
      [original.replace('1200;Momsfrit salg;salg;', '1200;Momsfrit salg;omkostning;'), /type kan ikke ændres/],
      [original + '1000;Dobbelt;salg;;nej\r\n', /står også på linje/],
      [original + '999;For lavt;salg;;nej\r\n', /Linje \d+: Kontonummer/],
      [original + '8000;;salg;;nej\r\n', /navn er påkrævet/],
      [original + '8100;Måske;salg;;måske\r\n', /Arkiveret skal være ja eller nej/],
      ['navn;type\r\nX;salg\r\n', /mangler kolonnen .{0,2}kontonr/],
      ['', /tom|Send CSV/]
    ];
    for (const [text, pattern] of cases) {
      const r = await upload(text);
      expect(r.status, text.slice(-40)).toBeGreaterThanOrEqual(400);
      expect(r.body).toMatch(pattern);
    }
    expect((await download()).text).toBe(before);
  });

  it('keeps the last active revenue account and refuses a file that archives them all', async () => {
    const allRevenueArchived = original.replace(/;salg;([^;]*);nej/g, ';salg;$1;ja');
    const r = await upload(allRevenueArchived);
    expect(r.status).toBe(409);
    expect(r.body).toContain('mindst én aktiv salgskonto');
    expect((await byNumber(1000)).archived).toBe(false);
    // Same guard on the single-account update.
    const revenue = (await accounts()).filter((a) => a.type === 'revenue');
    for (const a of revenue.slice(1)) expect((await c.json('PUT', `/api/accounts/${a.id}`, { archived: true })).status).toBe(200);
    const last = await c.json<{ error: string }>('PUT', `/api/accounts/${revenue[0].id}`, { archived: true });
    expect(last.status).toBe(409);
    expect(last.data.error).toContain('sidste aktive salgskonto');
    for (const a of revenue.slice(1)) expect((await c.json('PUT', `/api/accounts/${a.id}`, { archived: false })).status).toBe(200);
  });

  it('prune deletes unused accounts missing from the file and refuses when a used one is missing', async () => {
    const withoutUsed = original.split('\r\n').filter((l) => !l.startsWith('2900;')).join('\r\n');
    const refused = await upload(withoutUsed, { prune: true });
    expect(refused.status).toBe(409);
    expect(refused.body).toContain('2900');
    expect(refused.body).toContain('i brug');
    expect(await byNumber(2900)).toBeDefined();

    const withoutUnused = original.split('\r\n').filter((l) => !l.startsWith('7500;')).join('\r\n');
    const ok = await upload(withoutUnused, { prune: true });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ deleted: expect.any(Number), message: expect.stringContaining('slettet') });
    expect(await byNumber(7500)).toBeUndefined();
    // Without prune the same file leaves accounts alone and says so.
    expect((await upload(original)).status).toBe(200);
    expect(await byNumber(7500)).toBeDefined();
    const kept = JSON.parse((await upload(withoutUnused)).body) as { kept: number; message: string };
    expect(kept.kept).toBe(1);
    expect(kept.message).toContain('beholdt');
  });

  it('accepts comma-delimited files with English headers and JSON-style values', async () => {
    const text = 'number,name,type,group,archived\n1000,Konsulentydelser,revenue,Omsætning,false\n8200,"Kurser, eksterne",cost,Personale,true\n';
    const r = await upload(text);
    expect(r.status).toBe(200);
    expect(await byNumber(8200)).toMatchObject({ name: 'Kurser, eksterne', type: 'cost', group: 'Personale', archived: true });
    expect((await c.json('DELETE', `/api/accounts/${(await byNumber(8200)).id}`)).status).toBe(200);
  });
});
