/**
 * Read tools against the seeded app. Hand-computed seed figures (see the app's
 * tests/api/00-finance.test.ts): Likvider 105.305,00; Debitorer 27.750,00 (1004
 * 12.125,00 + 1005 15.625,00); Kreditorer 2.999,00 (voucher 8); Skyldig moms
 * 1.245,20; Skyldige kreditnotaer 15.000,00 (1006).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, money } from './helpers.js';
import { TOOL_NAMES } from '../src/tools.js';

let mcp: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  mcp = await connect();
});
afterAll(async () => {
  await mcp.close();
});

describe('tool surface', () => {
  it('lists exactly the 15 tools (spec items 1-14; item 14 is two lookups) with complete input schemas', async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description && t.description.length > 40).toBe(true);
      expect(t.inputSchema.type).toBe('object');
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName.list_invoices.inputSchema.properties ?? {})).toEqual(['status', 'due_before', 'year']);
    expect(byName.get_invoice.inputSchema.required).toEqual(['number']);
    expect(byName.mark_invoice_paid.inputSchema.required).toEqual(['number', 'paid_date']);
    expect(byName.create_cash_movement.inputSchema.required).toEqual(['date', 'description', 'amount_ore', 'kind']);
    expect(byName.reconcile_balance.inputSchema.required).toEqual(['actual_bank_balance_ore']);
    expect(byName.create_draft_invoice.inputSchema.required).toEqual(['customer_id', 'lines']);
    expect(byName.create_expense.inputSchema.required).toEqual(['date', 'supplier', 'description', 'account_id', 'amount_ex_vat_ore', 'vat_ore']);
    // The safety model: nothing issues, credits, deletes or edits issued documents.
    for (const name of tools.map((t) => t.name)) expect(name).not.toMatch(/issue|credit_note|delete|update|edit|remove/);
    for (const name of ['mark_invoice_paid', 'create_cash_movement', 'reconcile_balance', 'create_draft_invoice', 'create_expense']) {
      expect(byName[name].description).toMatch(/audit-logged/i);
    }
  });
});

describe('read tools on seed data', () => {
  it('list_invoices: default is open invoices soonest due first, overdue flagged', async () => {
    const r = await mcp.call<{ count: number; overdue_count: number; total: { amount_ore: number; amount_formatted: string }; invoices: { number: number; status: string; due_date: string; total: { amount_ore: number } }[] }>('list_invoices');
    expect(r.isError).toBe(false);
    expect(r.data.count).toBe(2);
    expect(r.data.invoices.map((i) => i.number)).toEqual([1004, 1005]);
    expect(r.data.invoices[0].status).toBe('overdue');
    expect(r.data.invoices[1].status).toBe('open');
    expect(r.data.total).toEqual({ amount_ore: 2_775_000, amount_formatted: '27.750,00 kr.' });
    expect(r.data.overdue_count).toBe(1);

    const paid = await mcp.call<{ invoices: { number: number }[] }>('list_invoices', { status: 'paid' });
    expect(paid.data.invoices.map((i) => i.number).sort()).toEqual([1001, 1003]);
    const all = await mcp.call<{ count: number }>('list_invoices', { status: 'all', year: 2026 });
    expect(all.data.count).toBe(6);
    const due = await mcp.call<{ invoices: { number: number }[] }>('list_invoices', { due_before: '2026-08-31' });
    expect(due.data.invoices.map((i) => i.number)).toEqual([1004]);
    const cn = await mcp.call<{ invoices: { number: number; credits_invoice_number: number }[] }>('list_invoices', { status: 'credit_note' });
    expect(cn.data.invoices).toEqual([expect.objectContaining({ number: 1006, credits_invoice_number: 1002 })]);
  });

  it('get_invoice: full detail with lines and payment state in exact øre', async () => {
    const r = await mcp.call<Record<string, any>>('get_invoice', { number: 1001 });
    expect(r.isError).toBe(false);
    expect(r.data.status).toBe('paid');
    expect(r.data.customer).toBe('Nordhavn Arkitekter ApS');
    expect(r.data.subtotal).toEqual({ amount_ore: 4_680_000, amount_formatted: '46.800,00 kr.' });
    expect(r.data.vat).toEqual(money(1_170_000));
    expect(r.data.total).toEqual(money(5_850_000));
    expect(r.data.lines.length).toBe(2);
    expect(r.data.lines[0]).toEqual(expect.objectContaining({ description: 'Konceptudvikling, uge 12–14', quantity: 42, unit: 'time', unit_price: money(95_000), line_total: money(3_990_000) }));
    expect(r.data.lines[0].account).toEqual(expect.objectContaining({ number: 1000 }));
    expect(r.data.payment).toEqual({ paid: true, paid_date: '2026-04-27', due_date: '2026-04-28' });
    expect(r.data.pdf_archived).toBe(true);
    expect(r.data.sent_at).toBe('2026-04-14');
    const missing = await mcp.call<{ error: string; http_status: number }>('get_invoice', { number: 4242 });
    expect(missing.isError).toBe(true);
    expect(missing.data.error).toBe('Not found');
    expect(missing.data.http_status).toBe(404);
  });

  it('list_expenses: all of 2026, and unpaid only', async () => {
    const r = await mcp.call<{ count: number; total_ex_vat: { amount_ore: number }; total_vat: { amount_ore: number }; expenses: { voucher_number: number; account: { number: number } }[] }>('list_expenses', { year: 2026 });
    expect(r.data.count).toBe(8);
    expect(r.data.total_ex_vat).toEqual(money(814_420));
    expect(r.data.total_vat).toEqual(money(145_455));
    const unpaid = await mcp.call<{ count: number; expenses: { voucher_number: number; amount_incl_vat: { amount_ore: number }; account: { number: number }; paid: boolean }[] }>('list_expenses', { year: 2026, unpaid_only: true });
    expect(unpaid.data.count).toBe(1);
    expect(unpaid.data.expenses[0]).toEqual(expect.objectContaining({ voucher_number: 8, paid: false, amount_incl_vat: money(299_900), account: expect.objectContaining({ number: 2100 }) }));
  });

  it('cash_position: the balance figures', async () => {
    const r = await mcp.call<Record<string, any>>('cash_position');
    expect(r.isError).toBe(false);
    expect(r.data.likvider).toEqual({ amount_ore: 10_530_500, amount_formatted: '105.305,00 kr.' });
    expect(r.data.debitorer).toEqual(money(2_775_000));
    expect(r.data.kreditorer).toEqual(money(299_900));
    expect(r.data.skyldige_kreditnotaer).toEqual(money(1_500_000));
    expect(r.data.skyldig_moms).toEqual(money(124_520));
    expect(r.data.nettoposition).toEqual(money(10_530_500 + 2_775_000 - 299_900 - 1_500_000 - 124_520));
    expect(r.data.last_reconciliation).toBeNull();
  });

  it('cashflow: actual months with hand-computed flows, projected months flagged', async () => {
    const r = await mcp.call<{ months: { month: string; flag: string; in: { amount_ore: number }; out: { amount_ore: number }; position: { amount_ore: number } }[]; position_now: { amount_ore: number }; projected_position_end: { amount: { amount_ore: number } } }>('cashflow', { months_back: 24 });
    const m = Object.fromEntries(r.data.months.map((x) => [x.month, x]));
    expect(m['2026-04']).toEqual(expect.objectContaining({ flag: 'actual', in: money(5_850_000), out: money(37_375), position: money(5_000_000 + 5_850_000 - 37_375) }));
    expect(m['2026-07'].out).toEqual(money(40_000 + 38_000 + 1_000_000));
    expect(r.data.position_now).toEqual(money(10_530_500));
    const projected = r.data.months.filter((x) => x.flag === 'projected');
    expect(projected.length).toBeGreaterThan(0);
    expect(r.data.months.filter((x) => x.flag === 'actual').every((x) => x.month < projected[0].month)).toBe(true);
    // 27.750,00 in, 2.999,00 + 15.000,00 + 1.245,20 out
    expect(r.data.projected_position_end.amount).toEqual(money(10_530_500 + 2_775_000 - 299_900 - 1_500_000 - 124_520));
    const short = await mcp.call<{ months: { month: string }[] }>('cashflow', { months_back: 1, months_forward: 0 });
    expect(short.data.months.length).toBe(2);
  });

  it('vat_report: Q2 2026 hand-computed, current quarter provisional, future quarter flagged estimate', async () => {
    const q2 = await mcp.call<Record<string, any>>('vat_report', { quarter: '2026-Q2' });
    expect(q2.isError).toBe(false);
    expect(q2.data.salgsmoms).toEqual(money(1_470_000));
    expect(q2.data.koebsmoms).toEqual(money(14_975));
    expect(q2.data.momstilsvar).toEqual({ amount_ore: 1_455_025, amount_formatted: '14.550,25 kr.' });
    expect(q2.data.settlement_deadline).toBe('2026-09-01');
    expect(q2.data.estimate).toBe(false);
    const current = await mcp.call<Record<string, any>>('vat_report');
    expect(current.data.provisional).toBe(true);
    expect(current.data.estimate).toBe(false);
    const future = await mcp.call<Record<string, any>>('vat_report', { quarter: '2031-Q1' });
    expect(future.data.estimate).toBe(true);
    expect(future.data.momstilsvar).toEqual(money(0));
    const bad = await mcp.call<{ error: string }>('vat_report', { quarter: 'next' });
    expect(bad.isError).toBe(true);
  });

  it('resultat and budget_status: accrual P&L per account, budget columns null', async () => {
    const r = await mcp.call<Record<string, any>>('resultat', { year: 2026 });
    expect(r.isError).toBe(false);
    const rev = Object.fromEntries(r.data.revenue.map((x: any) => [x.account.number, x.actual.amount_ore]));
    expect(rev[1100]).toBe(970_000);
    expect(rev[1200]).toBe(1_800_000);
    expect(r.data.costs_total).toEqual(money(814_420));
    expect(r.data.revenue[0].budget).toBeNull();
    expect(r.data.budget_exists).toBe(false);
    const q2 = await mcp.call<Record<string, any>>('resultat', { year: 2026, quarter: 2 });
    expect(q2.data.costs_total).toEqual(money(29_900 + 45_000 + 120_000));
    const b = await mcp.call<Record<string, any>>('budget_status', { year: 2026 });
    expect(b.data.budget_exists).toBe(false);
    expect(b.data.total.actual_ytd).toEqual(money(r.data.resultat.amount_ore));
    expect(b.data.total.budget_ytd).toBeNull();
  });

  it('list_accounts and list_customers resolve ids', async () => {
    const a = await mcp.call<{ count: number; accounts: { number: number; type: string }[] }>('list_accounts');
    expect(a.data.count).toBe(11);
    expect(a.data.accounts[0]).toMatchObject({ number: 1000, group: '', archived: false });
    const cost = await mcp.call<{ accounts: { type: string }[] }>('list_accounts', { type: 'cost' });
    expect(cost.data.accounts.every((x) => x.type === 'cost')).toBe(true);
    expect(cost.data.accounts.length).toBe(8);
    const c = await mcp.call<{ count: number; customers: { name: string; payment_terms_days: number | null }[] }>('list_customers');
    expect(c.data.count).toBe(3);
    expect(c.data.customers.find((x) => x.name.startsWith('Nordhavn'))?.payment_terms_days).toBe(30);
  });
});
