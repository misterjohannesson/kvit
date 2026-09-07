/**
 * The UI submission path: SvelteKit form actions with the same field encoding
 * the browser uses (Danish dates and amounts), verified through the JSON API.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, loggedIn } from './client';

let c: Client;
let customerId: number;

type Inv = { id: number; status: string; invoiceNumber: number | null; issueDate: string; dueDate: string; totalOre: number; paidDate: string | null };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** POST a form action like a browser: multipart body, text/html accept, follow nothing. */
async function action(path: string, fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) fd.set(k, v, 'fil.png');
    else fd.set(k, v);
  }
  return c.raw('POST', path, fd, { accept: 'text/html' });
}

beforeAll(async () => {
  c = await loggedIn();
  const cust = await c.json<{ id: number }>('POST', '/api/customers', {
    name: 'Formkunde ApS', address: 'Formvej 3', zip: '5000', city: 'Odense C', email: ''
  });
  customerId = cust.data.id;
});

describe('invoice editor form actions', () => {
  it('creates a draft, saves Danish-formatted lines and dates, issues with the confirmed number', async () => {
    const created = await action('/fakturaer?/create', { customerId: String(customerId) });
    expect(created.status).toBe(303);
    const location = created.headers.get('location')!;
    expect(location).toMatch(/^\/fakturaer\/\d+$/);
    const id = Number(location.split('/').pop());

    const lines = JSON.stringify([
      { description: 'Rådgivning', quantity: '2,50', unit: 'time', unitPrice: '1.000,00' },
      { description: 'Kørsel', quantity: '1', unit: 'stk.', unitPrice: '250' }
    ]);
    const saved = await action(`/fakturaer/${id}?/save`, {
      customerId: String(customerId),
      issueDate: '07.09.2026',
      dueDate: '21.09.2026',
      paymentReference: 'Reg. 1234 Konto 1234567890',
      lines
    });
    expect(saved.status).toBe(200);
    const draft = (await c.json<Inv>('GET', `/api/invoices/${id}`)).data;
    expect(draft.status).toBe('draft');
    expect(draft.issueDate).toBe('2026-09-07');
    expect(draft.dueDate).toBe('2026-09-21');
    expect(draft.totalOre).toBe(Math.round((250000 + 25000) * 1.25));

    const settings = await c.json<Record<string, string>>('GET', '/api/settings');
    const expected = Number(settings.data.next_invoice_number);

    // Stale confirmation number -> 409, nothing issued.
    const stale = await action(`/fakturaer/${id}?/issue`, {
      customerId: String(customerId), issueDate: '07.09.2026', dueDate: '21.09.2026',
      paymentReference: 'Reg. 1234 Konto 1234567890', lines, expectedNumber: String(expected + 1)
    });
    expect(stale.status).toBe(409);
    expect((await c.json<Inv>('GET', `/api/invoices/${id}`)).data.status).toBe('draft');

    const issued = await action(`/fakturaer/${id}?/issue`, {
      customerId: String(customerId), issueDate: '07.09.2026', dueDate: '21.09.2026',
      paymentReference: 'Reg. 1234 Konto 1234567890', lines, expectedNumber: String(expected)
    });
    expect(issued.status).toBe(303);
    expect(issued.headers.get('location')).toBe(`/fakturaer/${id}?udstedt=1`);
    const after = (await c.json<Inv>('GET', `/api/invoices/${id}`)).data;
    expect(after.status).toBe('issued');
    expect(after.invoiceNumber).toBe(expected);

    // Mark as paid with a Danish date.
    const paid = await action(`/fakturaer/${id}?/paid`, { paidDate: '22.09.2026' });
    expect(paid.status).toBe(200);
    expect((await c.json<Inv>('GET', `/api/invoices/${id}`)).data.paidDate).toBe('2026-09-22');

    // Credit through the form with a stale, then the right, confirmed number.
    const settings2 = await c.json<Record<string, string>>('GET', '/api/settings');
    const nextCredit = Number(settings2.data.next_invoice_number);
    const staleCredit = await action(`/fakturaer/${id}?/credit`, { expectedNumber: String(nextCredit + 1) });
    expect(staleCredit.status).toBe(409);
    const credited = await action(`/fakturaer/${id}?/credit`, { expectedNumber: String(nextCredit) });
    expect(credited.status).toBe(303);
    expect(credited.headers.get('location')).toMatch(/^\/fakturaer\/\d+$/);
    expect((await c.json<Inv>('GET', `/api/invoices/${id}`)).data.status).toBe('credited');

    // Saving an issued invoice through the form is refused too.
    const again = await action(`/fakturaer/${id}?/save`, {
      customerId: String(customerId), issueDate: '07.09.2026', dueDate: '21.09.2026', paymentReference: 'x', lines
    });
    expect(again.status).toBe(409);
  });

  it('rejects an invalid date with a field error and keeps the draft', async () => {
    const created = await action('/fakturaer?/create', { customerId: String(customerId) });
    const id = Number(created.headers.get('location')!.split('/').pop());
    const bad = await action(`/fakturaer/${id}?/save`, {
      customerId: String(customerId), issueDate: '2026-13-40', dueDate: '21.09.2026', paymentReference: 'x',
      lines: JSON.stringify([{ description: 'A', quantity: '1', unit: 'stk.', unitPrice: '1' }])
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Ugyldig dato');
    expect((await c.json('DELETE', `/api/invoices/${id}`)).status).toBe(200);
  });
});

describe('expense, settings and customer form actions', () => {
  it('books an expense with Danish amounts, a Danish date and a sniffed PNG', async () => {
    const r = await action('/udgifter?/create', {
      date: '05.09.2026', supplier: 'Formleverandør', description: 'Kabler', category: 'IT-udstyr',
      amountExVat: '199,20', vat: '49,80', paidDate: '', file: new Blob([PNG], { type: 'application/octet-stream' })
    });
    expect(r.status).toBe(303);
    const id = Number(r.headers.get('location')!.split('/').pop());
    const e = (await c.json<{ date: string; amountInclOre: number; filePath: string | null; paidDate: string | null }>('GET', `/api/expenses/${id}`)).data;
    expect(e.date).toBe('2026-09-05');
    expect(e.amountInclOre).toBe(24900);
    expect(e.paidDate).toBeNull();
    expect(e.filePath).toMatch(/\.png$/);

    const bad = await action('/udgifter?/create', {
      date: '05.09.2026', supplier: 'X', description: 'Y', category: 'Z', amountExVat: 'abc', vat: '0'
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('amountExVat');
  });

  it('saves settings and refuses to lower the next number', async () => {
    const before = (await c.json<Record<string, string>>('GET', '/api/settings')).data;
    const ok = await action('/indstillinger?/save', {
      company_name: before.company_name, company_address: before.company_address, company_zip: before.company_zip,
      company_city: before.company_city, company_cvr: before.company_cvr, bank_reg: before.bank_reg,
      bank_account: before.bank_account, payment_terms_days: '30', next_invoice_number: before.next_invoice_number, vat_registered: 'on'
    });
    expect(ok.status).toBe(200);
    expect((await c.json<Record<string, string>>('GET', '/api/settings')).data.payment_terms_days).toBe('30');
    const lower = await action('/indstillinger?/save', {
      company_name: before.company_name, company_address: before.company_address, company_zip: before.company_zip,
      company_city: before.company_city, company_cvr: before.company_cvr, bank_reg: before.bank_reg,
      bank_account: before.bank_account, payment_terms_days: '14', next_invoice_number: String(Number(before.next_invoice_number) - 1), vat_registered: 'on'
    });
    expect(lower.status).toBe(400);
    await action('/indstillinger?/save', {
      company_name: before.company_name, company_address: before.company_address, company_zip: before.company_zip,
      company_city: before.company_city, company_cvr: before.company_cvr, bank_reg: before.bank_reg,
      bank_account: before.bank_account, payment_terms_days: before.payment_terms_days, next_invoice_number: before.next_invoice_number, vat_registered: 'on'
    });
  });

  it('creates and edits a customer through the forms', async () => {
    const r = await action('/kunder?/create', { name: 'Form A/S', address: 'Gade 1', zip: '9000', city: 'Aalborg', country: 'DK', cvr: '', email: '' });
    expect(r.status).toBe(303);
    const id = Number(r.headers.get('location')!.split('/').pop());
    const upd = await action(`/kunder/${id}?/save`, { name: 'Form ApS', address: 'Gade 1', zip: '9000', city: 'Aalborg', country: 'DK', cvr: '87654321', email: '' });
    expect(upd.status).toBe(200);
    const cust = (await c.json<{ name: string; cvr: string }>('GET', `/api/customers/${id}`)).data;
    expect(cust.name).toBe('Form ApS');
    expect(cust.cvr).toBe('87654321');
    const del = await action(`/kunder/${id}?/delete`, {});
    expect(del.status).toBe(303);
  });
});
