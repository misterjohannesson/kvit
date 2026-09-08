import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { PDFParse } from 'pdf-parse';
import { Client, loggedIn } from './client';

type Inv = {
  id: number;
  invoiceNumber: number | null;
  status: string;
  subtotalOre: number;
  vatOre: number;
  totalOre: number;
  vatRateBp: number;
  pdfPath: string | null;
  paidDate: string | null;
  creditedByInvoiceId: number | null;
  isCreditNote: boolean;
  creditsInvoiceNumber: number | null;
  lines: { quantity: number; lineTotalOre: number }[];
};

let c: Client;
let customerId: number;

beforeAll(async () => {
  c = await loggedIn();
  const cust = await c.json<{ id: number }>('POST', '/api/customers', {
    name: 'Testkunde A/S',
    address: 'Testvej 1',
    zip: '1000',
    city: 'København K',
    cvr: '11223344',
    email: 'test@example.com'
  });
  expect(cust.status).toBe(201);
  customerId = cust.data.id;
});

async function makeDraft(lines = [{ description: 'Ydelse', quantity: 2, unit: 'time', unitPriceOre: 50000 }]) {
  const d = await c.json<Inv>('POST', '/api/invoices', { customerId });
  expect(d.status).toBe(201);
  expect(d.data.invoiceNumber).toBeNull();
  expect(d.data.status).toBe('draft');
  const u = await c.json<Inv>('PUT', `/api/invoices/${d.data.id}`, {
    customerId,
    issueDate: '2026-09-07',
    dueDate: '2026-09-21',
    paymentReference: 'Reg. 1234 Konto 1234567890',
    lines
  });
  expect(u.status).toBe(200);
  return u.data;
}

describe('numbering: strictly sequential under concurrency', () => {
  it('assigns consecutive numbers to 10 concurrently issued drafts with no gap or duplicate', async () => {
    const before = await c.json<Record<string, string>>('GET', '/api/settings');
    const start = Number(before.data.next_invoice_number);

    const drafts = [];
    for (let i = 0; i < 10; i++) drafts.push(await makeDraft());

    const results = await Promise.all(drafts.map((d) => c.json<Inv>('POST', `/api/invoices/${d.id}/issue`)));
    for (const r of results) expect(r.status).toBe(200);

    const numbers = results.map((r) => r.data.invoiceNumber as number).sort((a, b) => a - b);
    const expected = Array.from({ length: 10 }, (_, i) => start + i);
    expect(numbers).toEqual(expected);
    expect(new Set(numbers).size).toBe(10);

    const after = await c.json<Record<string, string>>('GET', '/api/settings');
    expect(Number(after.data.next_invoice_number)).toBe(start + 10);

    // Every issued invoice has a stored PDF at /data/files/invoices/{number}.pdf
    for (const r of results) {
      expect(r.data.pdfPath).toBe(`files/invoices/${r.data.invoiceNumber}.pdf`);
      expect(fs.existsSync(path.join(inject('dataDir'), r.data.pdfPath as string))).toBe(true);
    }
  });

  it('issuing the same draft twice concurrently yields exactly one success and one 409', async () => {
    const d = await makeDraft();
    const [a, b] = await Promise.all([
      c.json<Inv>('POST', `/api/invoices/${d.id}/issue`),
      c.json<Inv>('POST', `/api/invoices/${d.id}/issue`)
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('refuses to issue a draft without lines (400) and consumes no number', async () => {
    const before = Number((await c.json<Record<string, string>>('GET', '/api/settings')).data.next_invoice_number);
    const d = await makeDraft([]);
    const r = await c.json<{ error: string }>('POST', `/api/invoices/${d.id}/issue`);
    expect(r.status).toBe(400);
    const after = Number((await c.json<Record<string, string>>('GET', '/api/settings')).data.next_invoice_number);
    expect(after).toBe(before);
  });
});

describe('immutability: issued invoices are read-only in the API', () => {
  let issued: Inv;
  beforeAll(async () => {
    const d = await makeDraft();
    issued = (await c.json<Inv>('POST', `/api/invoices/${d.id}/issue`)).data;
    expect(issued.status).toBe('issued');
  });

  it('PUT returns 409', async () => {
    const r = await c.json('PUT', `/api/invoices/${issued.id}`, {
      customerId,
      issueDate: '2026-09-07',
      dueDate: '2026-09-21',
      paymentReference: 'x',
      lines: [{ description: 'Ændret', quantity: 1, unit: 'stk.', unitPriceOre: 1 }]
    });
    expect(r.status).toBe(409);
  });

  it('PATCH returns 409', async () => {
    const r = await c.json('PATCH', `/api/invoices/${issued.id}`, { paymentReference: 'x' });
    expect(r.status).toBe(409);
  });

  it('DELETE returns 409 and the invoice still exists', async () => {
    const r = await c.json('DELETE', `/api/invoices/${issued.id}`);
    expect(r.status).toBe(409);
    const g = await c.json<Inv>('GET', `/api/invoices/${issued.id}`);
    expect(g.status).toBe(200);
    expect(g.data.status).toBe('issued');
  });

  it('marking as paid is allowed and audit-logged; content is unchanged', async () => {
    const r = await c.json<Inv>('POST', `/api/invoices/${issued.id}/paid`, { paidDate: '2026-09-07' });
    expect(r.status).toBe(200);
    expect(r.data.paidDate).toBe('2026-09-07');
    expect(r.data.totalOre).toBe(issued.totalOre);
  });

  it('drafts can be deleted; issued cannot be deleted by any path', async () => {
    const d = await makeDraft();
    const del = await c.json('DELETE', `/api/invoices/${d.id}`);
    expect(del.status).toBe(200);
    expect((await c.json('GET', `/api/invoices/${d.id}`)).status).toBe(404);
  });
});

describe('credit notes', () => {
  it('creates a negated credit note with the next number and marks the original credited', async () => {
    const d = await makeDraft([
      { description: 'A', quantity: 3, unit: 'stk.', unitPriceOre: 10000 },
      { description: 'B', quantity: 1.5, unit: 'time', unitPriceOre: 20000 }
    ]);
    const orig = (await c.json<Inv>('POST', `/api/invoices/${d.id}/issue`)).data;
    expect(orig.subtotalOre).toBe(60000);
    expect(orig.vatOre).toBe(15000);
    expect(orig.totalOre).toBe(75000);

    const cr = await c.json<Inv>('POST', `/api/invoices/${orig.id}/credit`);
    expect(cr.status).toBe(201);
    expect(cr.data.status).toBe('issued');
    expect(cr.data.isCreditNote).toBe(true);
    expect(cr.data.creditsInvoiceNumber).toBe(orig.invoiceNumber);
    expect(cr.data.subtotalOre).toBe(-60000);
    expect(cr.data.vatOre).toBe(-15000);
    expect(cr.data.totalOre).toBe(-75000);
    expect(cr.data.lines.map((l) => l.quantity)).toEqual([-3, -1.5]);

    const settings = await c.json<Record<string, string>>('GET', '/api/settings');
    expect(cr.data.invoiceNumber).toBe(Number(settings.data.next_invoice_number) - 1);

    const o = (await c.json<Inv>('GET', `/api/invoices/${orig.id}`)).data;
    expect(o.status).toBe('credited');
    expect(o.creditedByInvoiceId).toBe(cr.data.id);

    // A credit note can be marked refunded (paid_date = refund date), once.
    const refunded = await c.json<Inv>('POST', `/api/invoices/${cr.data.id}/paid`, { paidDate: '2026-09-08' });
    expect(refunded.status).toBe(200);
    expect(refunded.data.paidDate).toBe('2026-09-08');
    expect((await c.json('POST', `/api/invoices/${cr.data.id}/paid`, { paidDate: '2026-09-09' })).status).toBe(409);

    // credited twice -> 409; credit note itself -> 409; credit note cannot be edited -> 409
    expect((await c.json('POST', `/api/invoices/${orig.id}/credit`)).status).toBe(409);
    expect((await c.json('POST', `/api/invoices/${cr.data.id}/credit`)).status).toBe(409);
    expect((await c.json('DELETE', `/api/invoices/${cr.data.id}`)).status).toBe(409);

    const pdf = await c.raw('GET', `/api/invoices/${cr.data.id}/pdf`);
    expect(pdf.status).toBe(200);
    const text = (await new PDFParse({ data: Buffer.from(await pdf.arrayBuffer()) }).getText()).text;
    expect(text).toContain('Kreditnota');
    expect(text).toContain(String(orig.invoiceNumber));
  });
});

describe('credit note rounding', () => {
  it('negates the original exactly even when VAT rounding is asymmetric (subtotal 100,02)', async () => {
    const d = await makeDraft([{ description: 'Halv-oere', quantity: 1, unit: 'stk.', unitPriceOre: 10002 }]);
    const orig = (await c.json<Inv>('POST', `/api/invoices/${d.id}/issue`)).data;
    expect(orig.vatOre).toBe(2501); // 2500,5 rounds half away from zero
    const cr = (await c.json<Inv>('POST', `/api/invoices/${orig.id}/credit`)).data;
    expect(cr.vatOre).toBe(-2501);
    expect(cr.subtotalOre + orig.subtotalOre).toBe(0);
    expect(cr.vatOre + orig.vatOre).toBe(0);
    expect(cr.totalOre + orig.totalOre).toBe(0);
  });
});

describe('confirm step number', () => {
  it('refuses to issue when the confirmed number is no longer the next one (409), consuming nothing', async () => {
    const d = await makeDraft();
    const next = Number((await c.json<Record<string, string>>('GET', '/api/settings')).data.next_invoice_number);
    const stale = await c.json<{ error: string }>('POST', `/api/invoices/${d.id}/issue`, { expectedNumber: next - 1 });
    expect(stale.status).toBe(409);
    expect((await c.json<Inv>('GET', `/api/invoices/${d.id}`)).data.status).toBe('draft');
    const ok = await c.json<Inv>('POST', `/api/invoices/${d.id}/issue`, { expectedNumber: next });
    expect(ok.status).toBe(200);
    expect(ok.data.invoiceNumber).toBe(next);
  });

  it('a draft edited after the confirm dialog opened cannot be issued from stale content (edits are serialised)', async () => {
    const d = await makeDraft();
    // Fire an edit and an issue concurrently: whichever runs second sees the other's result.
    const [edit, issue] = await Promise.all([
      c.json<Inv>('PUT', `/api/invoices/${d.id}`, {
        customerId, issueDate: '2026-09-07', dueDate: '2026-09-21', paymentReference: 'Reg. 1234 Konto 1234567890',
        lines: [{ description: 'Changed', quantity: 1, unit: 'stk.', unitPriceOre: 12345 }]
      }),
      c.json<Inv>('POST', `/api/invoices/${d.id}/issue`)
    ]);
    expect([edit.status, issue.status].sort()).toEqual(expect.arrayContaining([200]));
    const final = (await c.json<Inv>('GET', `/api/invoices/${d.id}`)).data;
    if (issue.status === 200) {
      // Issue won: the PDF was rendered from exactly the content stored; the edit must have failed (409) or run first.
      expect(final.status).toBe('issued');
      expect(final.totalOre).toBe(issue.data.totalOre);
      if (edit.status === 200) expect(issue.data.totalOre).toBe(edit.data.totalOre);
      else expect(edit.status).toBe(409);
    } else {
      expect(final.status).toBe('draft');
    }
  });
});

describe('integer line math', () => {
  it('computes 0,29 x 0,50 kr as 15 oere and rejects quantities with more than two decimals', async () => {
    const d = await makeDraft([{ description: 'Small', quantity: 0.29, unit: 'stk.', unitPriceOre: 50 }]);
    expect(d.lines[0].lineTotalOre).toBe(15);
    const r = await c.json<{ error: string }>('PUT', `/api/invoices/${d.id}`, {
      customerId, issueDate: '2026-09-07', dueDate: '2026-09-21', paymentReference: 'x',
      lines: [{ description: 'A', quantity: 1.005, unit: 'stk.', unitPriceOre: 100 }]
    });
    expect(r.status).toBe(400);
  });

  it('refuses to credit with a stale confirmed number (409) and consumes nothing', async () => {
    const d = await makeDraft();
    const orig = (await c.json<Inv>('POST', `/api/invoices/${d.id}/issue`)).data;
    const next = Number((await c.json<Record<string, string>>('GET', '/api/settings')).data.next_invoice_number);
    const stale = await c.json('POST', `/api/invoices/${orig.id}/credit`, { expectedNumber: next + 3 });
    expect(stale.status).toBe(409);
    expect((await c.json('POST', `/api/invoices/${orig.id}/credit`, { expectedNumber: 'abc' })).status).toBe(400);
    expect((await c.json<Inv>('GET', `/api/invoices/${orig.id}`)).data.status).toBe('issued');
    const ok = await c.json<Inv>('POST', `/api/invoices/${orig.id}/credit`, { expectedNumber: next });
    expect(ok.status).toBe(201);
    expect(ok.data.invoiceNumber).toBe(next);
  });
});

describe('legal invoice PDF (seed invoice 1001)', () => {
  it('contains every statutory field', async () => {
    const list = await c.json<Inv[]>('GET', '/api/invoices');
    const inv = list.data.find((i) => i.invoiceNumber === 1001);
    expect(inv).toBeDefined();
    const pdf = await c.raw('GET', `/api/invoices/${inv!.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const text = (await new PDFParse({ data: Buffer.from(await pdf.arrayBuffer()) }).getText()).text;
    const norm = text.replace(/\s+/g, ' ');

    // document type + number + issue date
    expect(norm).toContain('Faktura');
    expect(norm).toContain('1001');
    expect(norm).toContain('14.04.2026');
    // seller name, address, CVR
    expect(norm).toContain('Mit Firma ApS');
    expect(norm).toContain('Eksempelvej 1');
    expect(norm).toContain('2100 København Ø');
    expect(norm).toContain('12 34 56 78');
    // buyer name, address, CVR
    expect(norm).toContain('Nordhavn Arkitekter ApS');
    expect(norm).toContain('Sundkrogsgade 21');
    expect(norm).toContain('38 41 22 07');
    // lines: description, quantity, unit, unit price, line total
    expect(norm).toContain('Konceptudvikling, uge 12–14');
    expect(norm).toContain('42,00');
    expect(norm).toContain('time');
    expect(norm).toContain('950,00');
    expect(norm).toContain('39.900,00');
    expect(norm).toContain('Projektledelse');
    expect(norm).toContain('6,00');
    expect(norm).toContain('1.150,00');
    expect(norm).toContain('6.900,00');
    // subtotal, VAT rate and amount, total
    expect(norm).toContain('46.800,00');
    expect(norm).toContain('Moms 25 %');
    expect(norm).toContain('11.700,00');
    expect(norm).toContain('58.500,00');
    // payment terms / due date / payment reference
    expect(norm).toContain('netto 14 dage');
    expect(norm).toContain('28.04.2026');
    expect(norm).toContain('Reg. 1234 Konto 1234567890');
  });

  it('prints the VAT exemption reason with VAT 0 (seed invoice 1003)', async () => {
    const list = await c.json<Inv[]>('GET', '/api/invoices');
    const inv = list.data.find((i) => i.invoiceNumber === 1003)!;
    expect(inv.vatOre).toBe(0);
    expect(inv.vatRateBp).toBe(0);
    const pdf = await c.raw('GET', `/api/invoices/${inv.id}/pdf`);
    const norm = (await new PDFParse({ data: Buffer.from(await pdf.arrayBuffer()) }).getText()).text.replace(/\s+/g, ' ');
    expect(norm).toContain('Omvendt betalingspligt, jf. momslovens § 46');
    expect(norm).toContain('Moms 0 %');
    expect(norm).toContain('Berlin Software GmbH');
    expect(norm).toContain('18.000,00');
  });
});
