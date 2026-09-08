/**
 * Attachments merged into the issued PDF, the draft preview, and the sent status.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { Client, loggedIn } from './client';

type Attachment = { id: number; invoiceId: number; position: number; name: string; pages: number; sizeBytes: number; filePath: string };
type Inv = {
  id: number;
  invoiceNumber: number | null;
  status: string;
  issueDate: string;
  pdfPath: string | null;
  sentAt: string | null;
  isCreditNote: boolean;
  attachments: Attachment[];
};

let c: Client;
let customerId: number;

beforeAll(async () => {
  c = await loggedIn();
  const cust = await c.json<{ id: number }>('POST', '/api/customers', { name: 'Bilag ApS', address: 'Vej 2', zip: '2000', city: 'Frederiksberg', email: '' });
  customerId = cust.data.id;
});

async function pdfWithPages(n: number, label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} side ${i}`, { x: 50, y: 780, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

async function makeDraft(): Promise<Inv> {
  const d = (await c.json<Inv>('POST', '/api/invoices', { customerId })).data;
  const u = await c.json<Inv>('PUT', `/api/invoices/${d.id}`, {
    customerId,
    issueDate: '2026-09-07',
    dueDate: '2026-09-21',
    paymentReference: '',
    lines: [{ description: 'Konsulentarbejde', quantity: 3, unit: 'time', unitPriceOre: 100000 }]
  });
  expect(u.status).toBe(200);
  return u.data;
}

async function upload(invoiceId: number, bytes: Buffer, name: string) {
  const fd = new FormData();
  fd.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), name);
  return c.raw('POST', `/api/invoices/${invoiceId}/attachments`, fd);
}

async function pdfText(bytes: Buffer): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  const r = await parser.getText();
  await parser.destroy();
  return { text: r.text, pages: r.total };
}

describe('attachments', () => {
  it('appends PDFs to a draft, lists them on the invoice and merges them into the issued document', async () => {
    const draft = await makeDraft();
    const a = await upload(draft.id, await pdfWithPages(2, 'Timeopgørelse'), 'Timeopgoerelse uge 36.pdf');
    expect(a.status).toBe(201);
    const first = (await a.json()) as Attachment;
    expect(first.pages).toBe(2);
    expect(first.name).toBe('Timeopgoerelse uge 36.pdf');
    const b = await upload(draft.id, await pdfWithPages(1, 'Produktliste'), 'produkter.pdf');
    expect(b.status).toBe(201);

    // Not a PDF: refused, nothing stored.
    const png = new FormData();
    png.set('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])]), 'x.png');
    expect((await c.raw('POST', `/api/invoices/${draft.id}/attachments`, png)).status).toBe(400);

    const listed = (await c.json<Attachment[]>('GET', `/api/invoices/${draft.id}/attachments`)).data;
    expect(listed.map((x) => [x.position, x.pages])).toEqual([[1, 2], [2, 1]]);
    const detail = (await c.json<Inv>('GET', `/api/invoices/${draft.id}`)).data;
    expect(detail.attachments.length).toBe(2);

    // The original is served back.
    const file = await c.raw('GET', `/api/invoices/${draft.id}/attachments/${first.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');

    // Remove the second one again, then issue: invoice page + 2 attachment pages.
    expect((await c.json('DELETE', `/api/invoices/${draft.id}/attachments/${listed[1].id}`)).status).toBe(200);
    const issued = (await c.json<Inv>('POST', `/api/invoices/${draft.id}/issue`)).data;
    expect(issued.status).toBe('issued');
    expect(issued.attachments.length).toBe(1);
    const archived = fs.readFileSync(path.join(inject('dataDir'), issued.pdfPath!));
    const parsed = await pdfText(archived);
    expect(parsed.pages).toBe(3);
    expect(parsed.text).toContain(`Faktura ${issued.invoiceNumber}`);
    expect(parsed.text).toContain('Bilag vedlagt (2 sider følger)');
    expect(parsed.text).toContain('Timeopgoerelse uge 36.pdf');
    expect(parsed.text).toContain('Timeopgørelse side 2');

    // Frozen with the invoice.
    expect((await upload(issued.id, await pdfWithPages(1, 'x'), 'x.pdf')).status).toBe(409);
    expect((await c.json('DELETE', `/api/invoices/${issued.id}/attachments/${first.id}`)).status).toBe(409);
    expect((await c.json<Inv>('GET', `/api/invoices/${issued.id}`)).data.attachments.length).toBe(1);
  });

  it('a credit note carries no attachments and an issued PDF without attachments is untouched', async () => {
    const draft = await makeDraft();
    const issued = (await c.json<Inv>('POST', `/api/invoices/${draft.id}/issue`)).data;
    const parsed = await pdfText(fs.readFileSync(path.join(inject('dataDir'), issued.pdfPath!)));
    expect(parsed.pages).toBe(1);
    expect(parsed.text).not.toContain('Bilag vedlagt');
    const note = (await c.json<Inv>('POST', `/api/invoices/${issued.id}/credit`)).data;
    expect(note.attachments).toEqual([]);
  });
});

describe('draft preview', () => {
  it('renders the saved draft with attachments as UDKAST without a number and never stores it', async () => {
    const draft = await makeDraft();
    await upload(draft.id, await pdfWithPages(1, 'Bilag'), 'bilag.pdf');
    const r = await c.raw('GET', `/api/invoices/${draft.id}/preview`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const parsed = await pdfText(Buffer.from(await r.arrayBuffer()));
    expect(parsed.pages).toBe(2);
    expect(parsed.text).toContain('UDKAST');
    expect(parsed.text).toMatch(/udkast · ikke udstedt/i);
    expect(parsed.text).toContain('Bilag side 1');
    expect((await c.json<Inv>('GET', `/api/invoices/${draft.id}`)).data.pdfPath).toBeNull();
    expect(fs.readdirSync(path.join(inject('dataDir'), 'files', 'invoices')).filter((f) => f.endsWith('.pdf') && !/^\d+\.pdf$/.test(f))).toEqual([]);
    // Issued documents have no preview: the archived PDF is the document.
    const issued = (await c.json<Inv>('POST', `/api/invoices/${draft.id}/issue`)).data;
    expect((await c.raw('GET', `/api/invoices/${issued.id}/preview`)).status).toBe(409);
  });
});

describe('sent status', () => {
  it('is set once on issued documents, refused on drafts and repeats, and shows up in the list filter', async () => {
    const draft = await makeDraft();
    expect((await c.json('POST', `/api/invoices/${draft.id}/sent`, {})).status).toBe(409);
    const issued = (await c.json<Inv>('POST', `/api/invoices/${draft.id}/issue`)).data;
    expect(issued.sentAt).toBeNull();

    // Listed as unsent (issue date 07.09.2026 has arrived).
    const page = await c.raw('GET', '/fakturaer?status=usendte', undefined, { accept: 'text/html' });
    expect(await page.text()).toContain(`>${issued.invoiceNumber}<`);

    const bad = await c.json('POST', `/api/invoices/${issued.id}/sent`, { sentAt: '2026-13-01' });
    expect(bad.status).toBe(400);
    const ok = await c.json<Inv>('POST', `/api/invoices/${issued.id}/sent`, { sentAt: '2026-09-08' });
    expect(ok.status).toBe(200);
    expect(ok.data.sentAt).toBe('2026-09-08');
    expect((await c.json('POST', `/api/invoices/${issued.id}/sent`, { sentAt: '2026-09-09' })).status).toBe(409);
    expect((await c.json<Inv>('GET', `/api/invoices/${issued.id}`)).data.sentAt).toBe('2026-09-08');

    const after = await c.raw('GET', '/fakturaer?status=usendte', undefined, { accept: 'text/html' });
    expect(await after.text()).not.toContain(`>${issued.invoiceNumber}<`);
  });

  it('the seed leaves 1005 and the credit note 1006 unsent, which the dashboard flags', async () => {
    const all = (await c.json<Inv[]>('GET', '/api/invoices')).data;
    const byNumber = Object.fromEntries(all.filter((i) => i.invoiceNumber).map((i) => [i.invoiceNumber!, i]));
    expect(byNumber[1001].sentAt).toBe('2026-04-14');
    expect(byNumber[1004].sentAt).toBe('2026-08-04');
    expect(byNumber[1005].sentAt).toBeNull();
    expect(byNumber[1006].sentAt).toBeNull();
    const dash = await (await c.raw('GET', '/', undefined, { accept: 'text/html' })).text();
    expect(dash).toContain('er ikke sendt');
    expect(dash).toContain('Faktura 1005');
  });
});
