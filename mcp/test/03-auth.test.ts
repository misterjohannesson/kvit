/**
 * With a wrong or missing FAKTURA_API_TOKEN every tool fails with an auth error
 * and nothing changes in the app.
 */
import { describe, expect, it } from 'vitest';
import { appGet, connect } from './helpers.js';
import { TOOL_NAMES } from '../src/tools.js';

const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  get_invoice: { number: 1001 },
  mark_invoice_paid: { number: 1004, paid_date: '2026-09-08' },
  create_cash_movement: { date: '2026-09-08', description: 'x', amount_ore: -100, kind: 'other' },
  reconcile_balance: { actual_bank_balance_ore: 1 },
  create_draft_invoice: { customer_id: 1, lines: [{ description: 'x', quantity: 1, unit: 'stk.', unit_price_ore: 100 }] },
  create_expense: { date: '2026-09-08', supplier: 'x', description: 'y', account_id: 4, amount_ex_vat_ore: 100, vat_ore: 25 }
};

async function snapshot() {
  const [invoices, movements, expenses, audit] = await Promise.all([
    appGet<unknown[]>('/api/invoices'),
    appGet<unknown[]>('/api/cash-movements'),
    appGet<unknown[]>('/api/expenses?year=2026'),
    appGet<{ id: number }[]>('/api/audit?limit=1')
  ]);
  return { invoices: invoices.length, movements: movements.length, expenses: expenses.length, lastAuditId: audit[0]?.id ?? 0 };
}

describe('authentication failures', () => {
  it('a wrong token: every tool returns an auth error and no state changes', async () => {
    const before = await snapshot();
    const mcp = await connect('definitely-wrong');
    for (const name of TOOL_NAMES) {
      const r = await mcp.call<{ error: string; http_status: number }>(name, SAMPLE_ARGS[name] ?? {});
      expect(r.isError, name).toBe(true);
      expect(r.data.error, name).toBe('Authentication failed');
      expect(r.data.http_status, name).toBe(401);
    }
    await mcp.close();
    expect(await snapshot()).toEqual(before);
  });

  it('a missing token: every tool fails before any request is made, and no state changes', async () => {
    const before = await snapshot();
    const mcp = await connect(null);
    for (const name of TOOL_NAMES) {
      const r = await mcp.call<{ error: string; message: string }>(name, SAMPLE_ARGS[name] ?? {});
      expect(r.isError, name).toBe(true);
      expect(r.data.error, name).toBe('Authentication failed');
      expect(r.data.message, name).toMatch(/FAKTURA_API_TOKEN is not set/);
    }
    await mcp.close();
    expect(await snapshot()).toEqual(before);
  });
});
