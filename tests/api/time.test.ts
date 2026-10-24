/**
 * Tidsregistrering: logging, the lock rules, billing onto a draft (rounding, rates, headings with mixed rates),
 * releasing on draft delete, and staying billed through a credit note. Seed: Nordhavn (id 1, 950 kr./t) has three
 * unbilled entries (150 + 225 + 50 min) and one not billable; Vestergaard (id 2, 850 kr./t) two; Berlin (id 3) none
 * and no rate.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

type Entry = { id: number; customerId: number; minutes: number; hours: number; description: string; billable: boolean; status: string; invoiceId: number | null; invoiceNumber: number | null; invoiceStatus: string | null; invoicedHours: number | null; rateOre: number | null };
type Line = { description: string; quantity: number; unit: string; unitPriceOre: number; lineTotalOre: number; kind: string };
type Inv = { id: number; status: string; invoiceNumber: number | null; customerId: number; issueDate: string; dueDate: string; subtotalOre: number; lines: Line[] };
type TimeView = {
  rows: ({ type: 'group'; description: string; hours: number; invoicedHours: number; rateOre: number; lineTotalOre: number; diffOre: number | null; entries: number } | { type: 'entry'; entryId: number; indent: boolean; invoicedHours: number; rateOre: number | null; lineTotalOre: number; loggedValueOre: number | null; diffHours: number; diffOre: number | null })[];
  totals: { entries: number; hours: number; invoicedHours: number; lineTotalOre: number; loggedValueOre: number | null; diffOre: number | null };
};

let c: Client;
beforeAll(async () => {
  c = await loggedIn();
});

const entries = async (q: string) => (await c.json<Entry[]>('GET', `/api/time?${q}`)).data;

describe('logging time', () => {
  it('lists the seeded entries and the unbilled summary at the customer rate', async () => {
    const nordhavn = await entries('customerId=1');
    expect(nordhavn.map((e) => e.status).sort()).toEqual(['not_billable', 'unbilled', 'unbilled', 'unbilled']);
    const sum = (await c.json<{ customerId: number; entries: number; minutes: number; hours: number; valueOre: number | null }[]>('GET', '/api/time/unbilled')).data;
    expect(sum.find((s) => s.customerId === 1)).toEqual(expect.objectContaining({ entries: 3, minutes: 425, hours: 7.08, valueOre: 672_917 }));
    expect(sum.find((s) => s.customerId === 2)).toEqual(expect.objectContaining({ entries: 2, minutes: 465, valueOre: 658_750 }));
  });

  it('creates, edits and deletes an unbilled entry; hours become whole minutes', async () => {
    const r = await c.json<Entry>('POST', '/api/time', { customerId: 3, date: '2026-10-22', hours: 1.5, description: 'Kickoff' });
    expect(r.status).toBe(201);
    expect(r.data).toEqual(expect.objectContaining({ minutes: 90, hours: 1.5, status: 'unbilled', billable: true }));
    const upd = await c.json<Entry>('PATCH', `/api/time/${r.data.id}`, { minutes: 20, billable: false });
    expect(upd.data).toEqual(expect.objectContaining({ minutes: 20, hours: 0.33, status: 'not_billable', description: 'Kickoff' }));
    expect((await c.json('DELETE', `/api/time/${r.data.id}`)).status).toBe(200);
    expect((await c.json('GET', `/api/time/${r.data.id}`)).status).toBe(404);
  });

  it('refuses bad input with 400', async () => {
    for (const body of [
      { customerId: 1, date: '2026-10-22', hours: 25, description: 'x' },
      { customerId: 1, date: '2026-10-22', hours: 0, description: 'x' },
      { customerId: 1, date: '2026-02-30', hours: 1, description: 'x' },
      { customerId: 1, date: '2026-10-22', hours: 1, description: ' ' },
      { customerId: 999, date: '2026-10-22', hours: 1, description: 'x' },
      { customerId: 1, date: '2026-10-22', description: 'no time' }
    ]) {
      expect((await c.json('POST', '/api/time', body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('billing time on a draft', () => {
  let draft: Inv;
  let ids: number[];

  it('"Fakturér timer" puts every unbilled billable entry on a new draft, one line per entry at the customer rate', async () => {
    const r = await c.json<Inv>('POST', '/api/invoices/from-time', { customerId: 1 });
    expect(r.status).toBe(201);
    draft = r.data;
    expect(draft.status).toBe('draft');
    expect(draft.lines.map((l) => [l.kind, l.quantity, l.unitPriceOre])).toEqual([
      ['time', 2.5, 95_000],
      ['time', 3.75, 95_000],
      ['time', 0.83, 95_000]
    ]);
    const onDraft = await entries('customerId=1&status=draft');
    ids = onDraft.map((e) => e.id).sort((a, b) => a - b);
    expect(ids.length).toBe(3);
    expect((await entries('customerId=1&status=unbilled')).length).toBe(0);
    expect((await c.json('POST', '/api/invoices/from-time', { customerId: 1 })).status).toBe(400);
  });

  it('locks the logged part of an entry on a draft', async () => {
    const patch = await c.json<{ error: string }>('PATCH', `/api/time/${ids[0]}`, { description: 'changed' });
    expect(patch.status).toBe(409);
    expect(patch.data.error).toMatch(/kladde/);
    expect((await c.json('DELETE', `/api/time/${ids[0]}`)).status).toBe(409);
  });

  it('a heading sums its entries with mixed rates; the printed rate is total / hours', async () => {
    const r = await c.json<Inv>('PUT', `/api/invoices/${draft.id}`, {
      customerId: 1,
      issueDate: '2026-10-20',
      dueDate: '2026-11-19',
      lines: [{ description: 'Kørsel', quantity: 1, unit: 'stk.', unitPriceOre: 30_000 }],
      time: [
        { type: 'group', description: 'Rådgivning oktober' },
        { type: 'entry', entryId: ids[0], indent: true, invoicedHours: 2.5 },
        { type: 'entry', entryId: ids[1], indent: true, invoicedHours: 4, rateOre: 110_000 },
        { type: 'entry', entryId: ids[2], indent: false, invoicedHours: 1, invoicedDescription: 'Opfølgning' }
      ]
    });
    expect(r.status).toBe(200);
    // 2,5 × 950 + 4 × 1.100 = 6.775,00 over 6,5 t -> 1.042,31 kr./t (rounded), total kept exact.
    expect(r.data.lines.map((l) => [l.kind, l.description, l.quantity, l.unitPriceOre, l.lineTotalOre])).toEqual([
      ['time_group', 'Rådgivning oktober', 6.5, 104_231, 677_500],
      ['time', 'Opfølgning', 1, 95_000, 95_000],
      ['manual', 'Kørsel', 1, 30_000, 30_000]
    ]);
    expect(r.data.subtotalOre).toBe(677_500 + 95_000 + 30_000);

    const t = (await c.json<TimeView>('GET', `/api/invoices/${draft.id}/time`)).data;
    const group = t.rows[0];
    expect(group).toEqual(expect.objectContaining({ type: 'group', entries: 2, invoicedHours: 6.5, rateOre: 104_231, lineTotalOre: 677_500 }));
    // Logged 375 min at 950 = 5.937,50; invoiced 6.775,00 -> +837,50.
    expect(group.type === 'group' && group.diffOre).toBe(83_750);
    expect(t.totals).toEqual(expect.objectContaining({ entries: 3, invoicedHours: 7.5, lineTotalOre: 772_500, loggedValueOre: 672_917, diffOre: 99_583 }));
  });

  it('an API client sending the GET lines back does not duplicate the time lines', async () => {
    const cur = (await c.json<Inv>('GET', `/api/invoices/${draft.id}`)).data;
    const r = await c.json<Inv>('PUT', `/api/invoices/${draft.id}`, { customerId: 1, issueDate: cur.issueDate, dueDate: cur.dueDate, lines: cur.lines });
    expect(r.status).toBe(200);
    expect(r.data.lines.map((l) => l.kind)).toEqual(['time_group', 'time', 'manual']);
    expect(r.data.subtotalOre).toBe(cur.subtotalOre);
  });

  it('refuses an indented line without a heading, a not-billable entry, a foreign entry and a customer switch', async () => {
    const base = { customerId: 1, issueDate: '2026-10-20', dueDate: '2026-11-19', lines: [] };
    const orphan = await c.json('PUT', `/api/invoices/${draft.id}`, { ...base, time: [{ type: 'entry', entryId: ids[0], indent: true }] });
    expect(orphan.status).toBe(400);
    const notBillable = (await entries('customerId=1&status=not_billable'))[0];
    expect((await c.json('PUT', `/api/invoices/${draft.id}`, { ...base, time: [{ type: 'entry', entryId: notBillable.id }] })).status).toBe(400);
    const foreign = (await entries('customerId=2&status=unbilled'))[0];
    expect((await c.json('PUT', `/api/invoices/${draft.id}`, { ...base, time: [{ type: 'entry', entryId: foreign.id }] })).status).toBe(400);
    expect((await c.json('PUT', `/api/invoices/${draft.id}`, { ...base, customerId: 2 })).status).toBe(400);
    // Nothing above was written.
    expect((await c.json<TimeView>('GET', `/api/invoices/${draft.id}/time`)).data.totals.entries).toBe(3);
  });

  it('removing an entry from the draft releases it with its logged values untouched', async () => {
    const r = await c.json<Inv>('PUT', `/api/invoices/${draft.id}`, {
      customerId: 1,
      issueDate: '2026-10-20',
      dueDate: '2026-11-19',
      lines: [],
      time: [
        { type: 'group', description: 'Rådgivning oktober' },
        { type: 'entry', entryId: ids[0], indent: true },
        { type: 'entry', entryId: ids[1], indent: true }
      ]
    });
    expect(r.status).toBe(200);
    const released = (await c.json<Entry>('GET', `/api/time/${ids[2]}`)).data;
    expect(released).toEqual(expect.objectContaining({ status: 'unbilled', invoiceId: null, invoicedHours: null, rateOre: null, minutes: 50 }));
    // The kept entries keep what was set on the draft.
    expect((await c.json<Entry>('GET', `/api/time/${ids[1]}`)).data).toEqual(expect.objectContaining({ invoicedHours: 4, rateOre: 110_000 }));
  });

  it('deleting the draft releases all its time', async () => {
    expect((await c.json('DELETE', `/api/invoices/${draft.id}`)).status).toBe(200);
    expect((await entries('customerId=1&status=unbilled')).length).toBe(3);
  });
});

describe('issued and credited', () => {
  it('a draft without an hourly rate cannot be issued until a rate is set', async () => {
    const e = (await c.json<Entry>('POST', '/api/time', { customerId: 3, date: '2026-10-21', hours: 2, description: 'Architecture review' })).data;
    const d = (await c.json<Inv>('POST', '/api/invoices/from-time', { customerId: 3 })).data;
    expect(d.lines[0]).toEqual(expect.objectContaining({ kind: 'time', unitPriceOre: 0 }));
    const refused = await c.json<{ error: string }>('POST', `/api/invoices/${d.id}/issue`);
    expect(refused.status).toBe(400);
    expect(refused.data.error).toMatch(/timepris/);
    await c.json('PUT', `/api/invoices/${d.id}`, { customerId: 3, issueDate: '2026-10-21', dueDate: '2026-11-04', vatExemptReason: 'Omvendt betalingspligt, jf. momslovens § 46', lines: [], time: [{ type: 'entry', entryId: e.id, rateOre: 120_000 }] });
    await c.json('DELETE', `/api/invoices/${d.id}`);
  });

  it('issued time is billed and frozen; a credit note keeps it billed', async () => {
    const draft = (await c.json<Inv>('POST', '/api/invoices/from-time', { customerId: 2 })).data;
    const mine = (await entries('customerId=2&status=draft')).map((e) => e.id).sort((a, b) => a - b);
    const put = await c.json<Inv>('PUT', `/api/invoices/${draft.id}`, {
      customerId: 2,
      issueDate: '2026-10-20',
      dueDate: '2026-11-03',
      lines: [],
      time: [
        { type: 'group', description: 'Procesanalyse' },
        { type: 'entry', entryId: mine[0], indent: true, invoicedHours: 4 },
        { type: 'entry', entryId: mine[1], indent: true, invoicedHours: 3.5, rateOre: 90_000 }
      ]
    });
    // 4 × 850 + 3,5 × 900 = 6.550,00 over 7,5 t: printed rate 873,33, so 7,5 × 873,33 is 2 øre off the total, as agreed.
    expect(put.data.lines.map((l) => [l.kind, l.quantity, l.unitPriceOre, l.lineTotalOre])).toEqual([['time_group', 7.5, 87_333, 655_000]]);
    const issued = await c.json<Inv>('POST', `/api/invoices/${draft.id}/issue`);
    expect(issued.status).toBe(200);
    const billed = await entries('customerId=2&status=billed');
    expect(billed.length).toBe(2);
    expect(billed.every((e) => e.invoiceNumber === issued.data.invoiceNumber)).toBe(true);
    expect((await c.json('PATCH', `/api/time/${billed[0].id}`, { description: 'x' })).status).toBe(409);
    expect((await c.json('DELETE', `/api/time/${billed[0].id}`)).status).toBe(409);
    expect((await c.json('POST', '/api/invoices/from-time', { customerId: 2, entryIds: [billed[0].id] })).status).toBe(400);

    const credit = await c.json<Inv>('POST', `/api/invoices/${draft.id}/credit`);
    expect(credit.status).toBe(201);
    expect(credit.data.lines.map((l) => [l.kind, l.quantity, l.lineTotalOre])).toEqual([['time_group', -7.5, -655_000]]);
    const after = await entries('customerId=2&status=billed');
    expect(after.length).toBe(2);
    expect(after.every((e) => e.invoiceStatus === 'credited')).toBe(true);
    expect((await entries('customerId=2&status=unbilled')).length).toBe(0);
  });
});
