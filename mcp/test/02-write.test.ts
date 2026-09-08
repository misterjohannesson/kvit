/**
 * Write tools: each produces a row visible through the app's API afterwards,
 * with an audit_log entry where actor = "api". Runs after the read tests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appGet, connect, money, type AuditRow } from './helpers.js';

let mcp: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  mcp = await connect();
});
afterAll(async () => {
  await mcp.close();
});

describe('write tools', () => {
  it('mark_invoice_paid sets paid_date on 1005, refuses a repeat and a draft, and is audited as api', async () => {
    const r = await mcp.call<Record<string, any>>('mark_invoice_paid', { number: 1005, paid_date: '2026-09-08' });
    expect(r.isError).toBe(false);
    expect(r.data.paid_date).toBe('2026-09-08');
    expect(r.data.total).toEqual(money(1_562_500));
    const inv = await appGet<{ id: number; paidDate: string }>('/api/invoices/number/1005');
    expect(inv.paidDate).toBe('2026-09-08');
    const trail = await appGet<AuditRow[]>(`/api/audit?entity=invoice&entityId=${inv.id}&action=mark_paid`);
    expect(trail.length).toBe(1);
    expect(trail[0].actor).toBe('api');

    const again = await mcp.call<{ error: string; http_status: number; retry: boolean }>('mark_invoice_paid', { number: 1005, paid_date: '2026-09-09' });
    expect(again.isError).toBe(true);
    expect(again.data.http_status).toBe(409);
    expect(again.data.error).toMatch(/Conflict/);
    expect(again.data.retry).toBe(false);
    const open = await mcp.call<{ count: number }>('list_invoices');
    expect(open.data.count).toBe(1);
  });

  it('create_cash_movement appends a movement, audited as api', async () => {
    const r = await mcp.call<Record<string, any>>('create_cash_movement', { date: '2026-09-08', description: 'Bankgebyr, september', amount_ore: -4500, kind: 'other' });
    expect(r.isError).toBe(false);
    expect(r.data.amount).toEqual({ amount_ore: -4500, amount_formatted: '−45,00 kr.' });
    const rows = await appGet<{ id: number; amountOre: number }[]>('/api/cash-movements');
    expect(rows.find((m) => m.id === r.data.id)?.amountOre).toBe(-4500);
    const trail = await appGet<AuditRow[]>(`/api/audit?entity=cash_movement&entityId=${r.data.id}`);
    expect(trail[0].actor).toBe('api');
    const zero = await mcp.call<{ error: string }>('create_cash_movement', { date: '2026-09-08', description: 'x', amount_ore: 0, kind: 'other' });
    expect(zero.isError).toBe(true);
  });

  it('reconcile_balance books exactly the delta once, then nothing when the figure agrees', async () => {
    const before = await mcp.call<Record<string, any>>('cash_position');
    const likvider = before.data.likvider.amount_ore as number;
    // Wrong on purpose: 123,45 kr. more than computed.
    const r1 = await mcp.call<Record<string, any>>('reconcile_balance', { actual_bank_balance_ore: likvider + 12_345, date: '2026-09-08' });
    expect(r1.isError).toBe(false);
    expect(r1.data.computed_likvider_before).toEqual(money(likvider));
    expect(r1.data.difference).toEqual({ amount_ore: 12_345, amount_formatted: '123,45 kr.' });
    expect(r1.data.booked.amount).toEqual(money(12_345));
    const mv = await appGet<{ id: number; kind: string; amountOre: number }[]>('/api/cash-movements');
    expect(mv.find((m) => m.id === r1.data.booked.correction_movement_id)).toEqual(expect.objectContaining({ kind: 'correction', amountOre: 12_345 }));

    const r2 = await mcp.call<Record<string, any>>('reconcile_balance', { actual_bank_balance_ore: likvider + 12_345 });
    expect(r2.data.difference).toEqual(money(0));
    expect(r2.data.booked).toBeNull();
    const after = await mcp.call<Record<string, any>>('cash_position');
    expect(after.data.likvider).toEqual(money(likvider + 12_345));
    expect(after.data.last_reconciliation.difference_booked).toEqual(money(0));
    expect(after.data.last_reconciliation.bank_balance).toEqual(money(likvider + 12_345));
    const trail = await appGet<AuditRow[]>('/api/audit?entity=balance&action=reconcile');
    expect(trail.length).toBe(2);
    expect(trail.every((a) => a.actor === 'api')).toBe(true);
  });

  it('create_draft_invoice creates a numberless draft and says issuing is for the owner', async () => {
    const customers = await mcp.call<{ customers: { id: number; name: string }[] }>('list_customers');
    const accounts = await mcp.call<{ accounts: { id: number; number: number }[] }>('list_accounts', { type: 'revenue' });
    const acc1100 = accounts.data.accounts.find((a) => a.number === 1100)!.id;
    const r = await mcp.call<Record<string, any>>('create_draft_invoice', {
      customer_id: customers.data.customers[0].id,
      due_date: '2026-10-01',
      lines: [
        { description: 'Workshop', quantity: 1, unit: 'stk.', unit_price_ore: 500_000, account_id: acc1100 },
        { description: 'Forberedelse', quantity: 2.5, unit: 'time', unit_price_ore: 100_000 }
      ]
    });
    expect(r.isError).toBe(false);
    expect(r.data.created).toMatch(/draft/);
    expect(r.data.subtotal).toEqual(money(750_000));
    expect(r.data.vat).toEqual(money(187_500));
    expect(r.data.total).toEqual(money(937_500));
    expect(r.data.next_step).toMatch(/issued \(Udsted\) by the owner in the app UI/);
    const inv = await appGet<{ status: string; invoiceNumber: number | null; lines: { accountId: number }[] }>(`/api/invoices/${r.data.draft_id}`);
    expect(inv.status).toBe('draft');
    expect(inv.invoiceNumber).toBeNull();
    expect(inv.lines[0].accountId).toBe(acc1100);
    const trail = await appGet<AuditRow[]>(`/api/audit?entity=invoice&entityId=${r.data.draft_id}`);
    expect(trail.map((a) => a.action).sort()).toEqual(['create', 'update']);
    expect(trail.every((a) => a.actor === 'api')).toBe(true);
    // Invalid input: 400, and nothing written at all (no draft, no audit rows).
    const lastAudit = (await appGet<AuditRow[]>('/api/audit?limit=1'))[0].id;
    const invoicesBefore = (await appGet<unknown[]>('/api/invoices')).length;
    const bad = await mcp.call<{ error: string; http_status: number }>('create_draft_invoice', { customer_id: 999999, lines: [{ description: 'x', quantity: 1, unit: 'stk.', unit_price_ore: 100 }] });
    expect(bad.isError).toBe(true);
    expect(bad.data.http_status).toBe(400);
    const badLines = await mcp.call<{ http_status: number }>('create_draft_invoice', { customer_id: customers.data.customers[0].id, lines: [{ description: 'x', quantity: 1, unit: 'stk.', unit_price_ore: 100, account_id: 999999 }] });
    expect(badLines.data.http_status).toBe(400);
    expect((await appGet<AuditRow[]>('/api/audit?limit=1'))[0].id).toBe(lastAudit);
    expect((await appGet<unknown[]>('/api/invoices')).length).toBe(invoicesBefore);
  });

  it('create_expense creates voucher 9 and reminds about the bilag file', async () => {
    const accounts = await mcp.call<{ accounts: { id: number; number: number }[] }>('list_accounts', { type: 'cost' });
    const acc2000 = accounts.data.accounts.find((a) => a.number === 2000)!.id;
    const r = await mcp.call<Record<string, any>>('create_expense', {
      date: '2026-09-08',
      supplier: 'Hetzner Online GmbH',
      description: 'Serverhosting, september',
      account_id: acc2000,
      amount_ex_vat_ore: 38_000,
      vat_ore: 0
    });
    expect(r.isError).toBe(false);
    expect(r.data.voucher_number).toBe(9);
    expect(r.data.amount_incl_vat).toEqual(money(38_000));
    expect(r.data.has_file).toBe(false);
    expect(r.data.next_step).toMatch(/bilag/i);
    const e = await appGet<{ voucherNumber: number; accountId: number; filePath: string | null }[]>('/api/expenses?year=2026');
    expect(e.find((x) => x.voucherNumber === 9)).toEqual(expect.objectContaining({ accountId: acc2000, filePath: null }));
    const trail = await appGet<AuditRow[]>(`/api/audit?entity=expense&entityId=${r.data.id}`);
    expect(trail[0].actor).toBe('api');
    const revenueAcc = (await mcp.call<{ accounts: { id: number }[] }>('list_accounts', { type: 'revenue' })).data.accounts[0].id;
    const wrongType = await mcp.call<{ http_status: number }>('create_expense', { date: '2026-09-08', supplier: 'x', description: 'y', account_id: revenueAcc, amount_ex_vat_ore: 100, vat_ore: 25 });
    expect(wrongType.isError).toBe(true);
    expect(wrongType.data.http_status).toBe(400);
  });
});
