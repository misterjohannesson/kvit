/**
 * The 15 tools (spec items 1-14; item 14 is two lookups). Tool names and
 * descriptions are English; data values stay Danish. Every amount is returned as
 * { amount_ore, amount_formatted }. Errors from the app come back as structured
 * tool errors (isError) with the HTTP status and the app's message, never as a
 * retry. Deliberately absent: issuing, crediting, deleting, editing issued
 * documents. Those consume or alter the legal number series and stay human-only.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { FakturaClient, FakturaError, type Account, type Expense, type InvoiceDetail, type InvoiceRow } from './client.js';
import { daysBetween, isIsoDate, money, parseQuarter, quarterOf, quarterRange, todayIso, vatSettlementDate } from './format.js';

const HUMAN_ONLY = 'Issuing (Udsted) and crediting (Opret kreditnota) are intentionally not possible via MCP: they consume numbers from the legal series and are irreversible, so the owner does them in the app UI.';

// ---------------------------------------------------------------------------
// Result helpers

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown): CallToolResult {
  if (e instanceof FakturaError) {
    const label: Record<FakturaError['kind'], string> = {
      auth: 'Authentication failed',
      not_found: 'Not found',
      conflict: 'Conflict (immutability rule)',
      validation: 'Validation error',
      unavailable: 'App unavailable',
      error: 'Error'
    };
    const body = {
      error: label[e.kind],
      http_status: e.status || null,
      message: e.message,
      fields: Object.keys(e.fields).length ? e.fields : undefined,
      retry: false as const,
      hint:
        e.kind === 'conflict'
          ? 'The app refused the change because the document is issued/immutable or the state moved. Do not retry the same call; report this to the owner.'
          : e.kind === 'auth'
            ? 'Check FAKTURA_API_TOKEN against the app\'s API_TOKEN. No request mutated state.'
            : undefined
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'Error', message, retry: false }, null, 2) }] };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Shapes

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date yyyy-mm-dd').refine(isIsoDate, 'Not a real calendar date');
const yearSchema = z.number().int().min(2000).max(2100);
const oreInt = z.number().int();
const posOreInt = z.number().int().min(0);
const movementKinds = ['vat_payment', 'owner', 'tax', 'correction', 'other'] as const;

type InvoiceState = 'draft' | 'open' | 'overdue' | 'paid' | 'credited' | 'credit_note';

function invoiceState(r: InvoiceRow, today: string): InvoiceState {
  if (r.status === 'draft') return 'draft';
  if (r.status === 'credited') return 'credited';
  if (r.isCreditNote) return 'credit_note';
  if (r.paidDate) return 'paid';
  return r.dueDate < today ? 'overdue' : 'open';
}

function invoiceSummary(r: InvoiceRow, today: string) {
  const state = invoiceState(r, today);
  return {
    number: r.invoiceNumber,
    id: r.id,
    kind: r.isCreditNote ? 'credit_note' : 'invoice',
    status: state,
    overdue_days: state === 'overdue' ? daysBetween(r.dueDate, today) : undefined,
    customer: r.customerName,
    customer_id: r.customerId,
    issue_date: r.status === 'draft' ? null : r.issueDate,
    due_date: r.isCreditNote || r.status === 'draft' ? null : r.dueDate,
    paid_date: r.paidDate,
    sent_at: r.sentAt,
    subtotal: money(r.subtotalOre),
    vat: money(r.vatOre),
    total: money(r.totalOre),
    credits_invoice_number: r.creditsInvoiceNumber,
    credited_by_number: r.creditedByNumber
  };
}

function invoiceFull(inv: InvoiceDetail, accounts: Account[], today: string) {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  return {
    ...invoiceSummary(inv, today),
    vat_rate_percent: inv.vatRateBp / 100,
    vat_exempt_reason: inv.vatExemptReason,
    payment_reference: inv.paymentReference,
    customer_details: {
      id: inv.customer.id,
      name: inv.customer.name,
      address: inv.customer.address,
      zip: inv.customer.zip,
      city: inv.customer.city,
      country: inv.customer.country,
      cvr: inv.customer.cvr,
      email: inv.customer.email
    },
    lines: inv.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: money(l.unitPriceOre),
      line_total: money(l.lineTotalOre),
      account: acc.get(l.accountId) ? { id: l.accountId, number: acc.get(l.accountId)!.number, name: acc.get(l.accountId)!.name } : { id: l.accountId }
    })),
    payment: inv.isCreditNote
      ? { refunded: !!inv.paidDate, refunded_date: inv.paidDate, original_paid_date: inv.originalPaidDate }
      : { paid: !!inv.paidDate, paid_date: inv.paidDate, due_date: inv.dueDate },
    pdf_archived: !!inv.pdfPath,
    attachments: inv.attachments.map((a) => ({ name: a.name, pages: a.pages, size_bytes: a.sizeBytes }))
  };
}

function expenseSummary(e: Expense, accounts: Map<number, Account>) {
  const a = accounts.get(e.accountId);
  return {
    voucher_number: e.voucherNumber,
    id: e.id,
    date: e.date,
    supplier: e.supplier,
    description: e.description,
    account: a ? { id: a.id, number: a.number, name: a.name } : { id: e.accountId },
    amount_ex_vat: money(e.amountExVatOre),
    vat: money(e.vatOre),
    amount_incl_vat: money(e.amountInclOre),
    paid: !!e.paidDate,
    paid_date: e.paidDate,
    has_file: !!e.filePath
  };
}

// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
  'list_invoices',
  'get_invoice',
  'list_expenses',
  'cash_position',
  'cashflow',
  'vat_report',
  'resultat',
  'budget_status',
  'mark_invoice_paid',
  'create_cash_movement',
  'reconcile_balance',
  'create_draft_invoice',
  'create_expense',
  'list_accounts',
  'list_customers'
] as const;

export function registerTools(server: McpServer, client: FakturaClient): void {
  // ------------------------------------------------------------------ read

  server.registerTool(
    'list_invoices',
    {
      title: 'List invoices',
      description:
        'Invoices and credit notes with number, customer, dates, amounts and status. With no arguments: open (unpaid, issued) invoices, soonest due first, overdue ones included and flagged. Answers "what is coming in" and "who is overdue". Amounts are DKK incl. VAT unless named otherwise.',
      inputSchema: {
        status: z
          .enum(['open', 'overdue', 'paid', 'draft', 'credited', 'credit_note', 'all'])
          .optional()
          .describe('Filter. open = issued and unpaid (includes overdue); overdue = open and past due date; default open.'),
        due_before: isoDate.optional().describe('Only invoices due on or before this ISO date.'),
        year: yearSchema.optional().describe('Only documents dated in this year.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ status, due_before, year }) =>
      run(async () => {
        const today = todayIso();
        const want = status ?? 'open';
        let rows = (await client.listInvoices({ year })).map((r) => ({ r, state: invoiceState(r, today) }));
        if (want === 'open') rows = rows.filter((x) => x.state === 'open' || x.state === 'overdue');
        else if (want !== 'all') rows = rows.filter((x) => x.state === want);
        if (due_before) rows = rows.filter((x) => x.r.status !== 'draft' && !x.r.isCreditNote && x.r.dueDate <= due_before);
        rows.sort((a, b) => a.r.dueDate.localeCompare(b.r.dueDate) || (a.r.invoiceNumber ?? 0) - (b.r.invoiceNumber ?? 0));
        const list = rows.map((x) => invoiceSummary(x.r, today));
        return {
          as_of: today,
          filter: { status: want, due_before: due_before ?? null, year: year ?? null },
          count: list.length,
          total: money(list.reduce((s, i) => s + i.total.amount_ore, 0)),
          overdue_count: list.filter((i) => i.status === 'overdue').length,
          invoices: list
        };
      })
  );

  server.registerTool(
    'get_invoice',
    {
      title: 'Get invoice',
      description: 'Full detail of one issued invoice or credit note by its number: customer, lines with accounts, VAT, totals, payment state, sent state, attachments and whether the archived PDF exists.',
      inputSchema: { number: z.number().int().positive().describe('The invoice number (e.g. 1004). Drafts have no number.') },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ number }) =>
      run(async () => {
        const [inv, accounts] = await Promise.all([client.getInvoiceByNumber(number), client.listAccounts()]);
        return invoiceFull(inv, accounts, todayIso());
      })
  );

  server.registerTool(
    'list_expenses',
    {
      title: 'List expenses',
      description: 'Expenses (udgifter) with voucher number, supplier, cost account, amounts ex/incl. VAT and paid state. Default: the current year, newest first.',
      inputSchema: {
        year: yearSchema.optional().describe('Expense date year; default current year.'),
        unpaid_only: z.boolean().optional().describe('Only expenses without a paid date.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ year, unpaid_only }) =>
      run(async () => {
        const y = year ?? Number(todayIso().slice(0, 4));
        const [rows, accounts] = await Promise.all([client.listExpenses({ year: y }), client.listAccounts()]);
        const acc = new Map(accounts.map((a) => [a.id, a]));
        const list = (unpaid_only ? rows.filter((e) => !e.paidDate) : rows).map((e) => expenseSummary(e, acc));
        return {
          year: y,
          unpaid_only: !!unpaid_only,
          count: list.length,
          total_ex_vat: money(list.reduce((s, e) => s + e.amount_ex_vat.amount_ore, 0)),
          total_vat: money(list.reduce((s, e) => s + e.vat.amount_ore, 0)),
          total_incl_vat: money(list.reduce((s, e) => s + e.amount_incl_vat.amount_ore, 0)),
          expenses: list
        };
      })
  );

  server.registerTool(
    'cash_position',
    {
      title: 'Cash position (Balance)',
      description:
        'The Balance view: likvider (bank position from the opening balance plus every paid flow), debitorer (open invoices), kreditorer (unpaid expenses), skyldige kreditnotaer, skyldig moms and nettoposition, plus the date of the last reconciliation. Answers "what is my current bank".',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () =>
      run(async () => {
        const b = await client.balance();
        return {
          as_of: b.asOf,
          likvider: money(b.likviderOre),
          debitorer: money(b.debitorerOre),
          kreditorer: money(b.kreditorerOre),
          skyldige_kreditnotaer: money(b.skyldigeKreditnotaerOre),
          skyldig_moms: money(b.skyldigMomsOre),
          nettoposition: money(b.nettoOre),
          detail: {
            opening_balance: money(b.openingBalanceOre),
            accrued_vat: money(b.accruedVatOre),
            vat_payments: money(b.vatPaymentsOre),
            open_invoices: b.openInvoices,
            unpaid_expenses: b.unpaidExpenses,
            open_credit_notes: b.openCreditNotes
          },
          last_reconciliation: b.lastReconciliation
            ? {
                date: b.lastReconciliation.date,
                recorded_at: b.lastReconciliation.at,
                bank_balance: money(b.lastReconciliation.actualOre),
                difference_booked: money(b.lastReconciliation.differenceOre),
                correction_movement_id: b.lastReconciliation.bookedMovementId
              }
            : null
        };
      })
  );

  server.registerTool(
    'cashflow',
    {
      title: 'Cashflow by month',
      description:
        'Monthly in/out/net and running bank position. Closed months are actuals (flag "actual"); the current month and every month ahead are "projected": actuals to date plus the forecast of open invoices by due month, unpaid expenses, credit notes to refund and VAT by settlement deadline. Note: the app has no budget yet, so the projection is not budget-blended; the response says so.',
      inputSchema: {
        months_back: z.number().int().min(0).max(120).optional().describe('How many closed months before the current one to include; default 6.'),
        months_forward: z.number().int().min(0).max(24).optional().describe('How many months after the current one; default: every month the forecast reaches.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ months_back, months_forward }) =>
      run(async () => {
        const cf = await client.cashflow();
        const currentIdx = cf.months.findIndex((m) => m.kind !== 'closed');
        const back = months_back ?? 6;
        const from = Math.max(0, (currentIdx < 0 ? cf.months.length : currentIdx) - back);
        const to = months_forward === undefined ? cf.months.length : Math.min(cf.months.length, (currentIdx < 0 ? cf.months.length : currentIdx) + 1 + months_forward);
        const months = cf.months.slice(from, to).map((m) => {
          const projected = m.kind !== 'closed';
          const inOre = m.inOre + m.forecastInOre;
          const outOre = m.outOre + m.forecastOutOre;
          return {
            month: m.month,
            flag: projected ? 'projected' : 'actual',
            in: money(inOre),
            out: money(outOre),
            net: money(inOre - outOre),
            position: money(projected ? m.projectedPositionOre : m.positionOre),
            ...(projected && m.kind === 'current' ? { actual_to_date: { in: money(m.inOre), out: money(m.outOre) } } : {})
          };
        });
        return {
          opening_balance: { date: cf.openingBalanceDate, amount: money(cf.openingBalanceOre) },
          position_now: money(cf.closingPositionOre),
          projected_position_end: { month: cf.forecast.toMonth, amount: money(cf.forecast.projectedPositionOre) },
          months,
          forecast_items: cf.forecast.items.map((i) => ({ month: i.month, kind: i.kind, label: i.label, detail: i.detail, amount: money(i.amountOre) })),
          note: 'Projection = open invoices by due month (overdue ones now), unpaid expenses, credit notes to refund and skyldig moms on the kvartalsmoms deadlines. No budget exists in the app, so budget blending is not applied.'
        };
      })
  );

  server.registerTool(
    'vat_report',
    {
      title: 'VAT report (momsindberetning)',
      description:
        'Salgsmoms, købsmoms and momstilsvar for one quarter, the three figures on skat.dk\'s momsangivelse, with the settlement deadline. Default: the current quarter. Future quarters are flagged estimate: true (figures come from documents already dated in that quarter; the app has no budget to estimate from).',
      inputSchema: {
        quarter: z.string().optional().describe('Quarter as "2026-Q3" (also "2026-3"). Default: current quarter.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ quarter }) =>
      run(async () => {
        const today = todayIso();
        const q = quarter ? parseQuarter(quarter) : quarterOf(today);
        const r = await client.vatReport(q.year, q.quarter);
        const range = quarterRange(q.year, q.quarter);
        const now = quarterOf(today);
        const future = q.year > now.year || (q.year === now.year && q.quarter > now.quarter);
        const current = q.year === now.year && q.quarter === now.quarter;
        return {
          quarter: `${q.year}-Q${q.quarter}`,
          from: range.from,
          to: range.to,
          settlement_deadline: vatSettlementDate(q.year, q.quarter),
          estimate: future,
          provisional: current,
          salgsmoms: money(r.salesVatOre),
          koebsmoms: money(r.purchaseVatOre),
          momstilsvar: money(r.netVatOre),
          sales_ex_vat: money(r.salesExVatOre),
          purchases_ex_vat: money(r.purchasesExVatOre),
          sales_documents: r.salesRows.length,
          purchase_vouchers: r.purchaseRows.length,
          note: future
            ? 'Estimate: only documents already dated in this future quarter are counted; there is no budget in the app to estimate the rest from.'
            : current
              ? 'The quarter is still running; figures grow until it closes.'
              : undefined
        };
      })
  );

  server.registerTool(
    'resultat',
    {
      title: 'Resultat (P&L)',
      description:
        'Profit and loss per account on accrual basis: revenue per revenue account (issued invoices ex VAT, credit notes netting out), costs per cost account (expenses ex VAT) and resultat før skat. Default: the current year. Budget and variance columns are null until a budget exists in the app.',
      inputSchema: {
        year: yearSchema.optional().describe('Default current year.'),
        quarter: z.number().int().min(1).max(4).optional().describe('Restrict to one quarter of the year.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ year, quarter }) =>
      run(async () => {
        const y = year ?? Number(todayIso().slice(0, 4));
        const r = await client.resultat(y, quarter);
        const row = (x: { account: Account; totalOre: number }) => ({
          account: { id: x.account.id, number: x.account.number, name: x.account.name },
          actual: money(x.totalOre),
          budget: null,
          variance: null
        });
        return {
          year: r.year,
          quarter: r.quarter,
          from: r.from,
          to: r.to,
          revenue: r.revenue.map(row),
          costs: r.costs.map(row),
          revenue_total: money(r.revenueOre),
          costs_total: money(r.costsOre),
          resultat: money(r.resultOre),
          budget_exists: false,
          note: 'Accrual basis. No budget is configured in the app, so budget and variance are null.'
        };
      })
  );

  server.registerTool(
    'budget_status',
    {
      title: 'Budget status',
      description:
        'Year-to-date actual vs budget per account and in total. The app has no budget feature yet: the tool returns budget_exists: false with the YTD actuals per account and null budget/variance, so callers can rely on one shape.',
      inputSchema: { year: yearSchema.optional().describe('Default current year.') },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ year }) =>
      run(async () => {
        const today = todayIso();
        const y = year ?? Number(today.slice(0, 4));
        const r = await client.resultat(y);
        const row = (x: { account: Account; totalOre: number }) => ({
          account: { id: x.account.id, number: x.account.number, name: x.account.name },
          actual_ytd: money(x.totalOre),
          budget_ytd: null,
          variance: null
        });
        return {
          year: y,
          as_of: today,
          budget_exists: false,
          revenue: r.revenue.map(row),
          costs: r.costs.map(row),
          total: { actual_ytd: money(r.resultOre), budget_ytd: null, variance: null },
          note: 'No budget exists in the app for this year (the budget feature is not built). Actuals are accrual-basis year to date.'
        };
      })
  );

  // ------------------------------------------------------------------ write

  server.registerTool(
    'mark_invoice_paid',
    {
      title: 'Mark invoice paid',
      description:
        'Sets the paid date on an issued invoice (on a credit note: the refund date). Changes paid_date only; the document itself stays immutable. Audit-logged with actor "api". Fails with a conflict if the invoice is a draft, already paid, or the number does not exist.',
      inputSchema: {
        number: z.number().int().positive().describe('Invoice number.'),
        paid_date: isoDate.describe('The date the money arrived, ISO yyyy-mm-dd.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ number, paid_date }) =>
      run(async () => {
        const inv = await client.getInvoiceByNumber(number);
        const updated = await client.markPaid(inv.id, paid_date);
        return {
          changed: inv.isCreditNote ? 'credit note marked refunded' : 'invoice marked paid',
          number: updated.invoiceNumber,
          paid_date: updated.paidDate,
          total: money(updated.totalOre),
          audit: 'logged as actor api'
        };
      })
  );

  server.registerTool(
    'create_cash_movement',
    {
      title: 'Create cash movement',
      description:
        'Books a bank movement that is neither an invoice payment nor an expense: VAT payment, owner deposit/draw, tax, correction, other. Positive amount = money in, negative = money out. Movements are append-only (never edited or deleted; a mistake gets a correction). Audit-logged with actor "api".',
      inputSchema: {
        date: isoDate.describe('Movement date, ISO.'),
        description: z.string().trim().min(1).max(300).describe('Free text, Danish, e.g. "Momsafregning 2. kvartal 2026".'),
        amount_ore: oreInt.refine((n) => n !== 0, 'Amount must not be 0').describe('Signed integer øre: positive = in, negative = out.'),
        kind: z.enum(movementKinds).describe('vat_payment | owner | tax | correction | other')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ date, description, amount_ore, kind }) =>
      run(async () => {
        const m = await client.createMovement({ date, description, amountOre: amount_ore, kind });
        return { created: 'cash movement', id: m.id, date: m.date, description: m.description, kind: m.kind, amount: money(m.amountOre), audit: 'logged as actor api' };
      })
  );

  server.registerTool(
    'reconcile_balance',
    {
      title: 'Reconcile bank balance (afstemning)',
      description:
        'The afstemning ritual: give the actual balance from the bank. The app compares it with computed likvider and, if they differ, books a "correction" cash movement for exactly the difference so likvider matches the bank. Returns both figures and the delta. A second call with a matching figure books nothing. Every call is audit-logged with actor "api" (the booked correction too). Answers "register my balance today".',
      inputSchema: {
        actual_bank_balance_ore: oreInt.describe('The balance shown by the bank, in integer øre (e.g. 10530500 for 105.305,00 kr.).'),
        date: isoDate.optional().describe('Date of the reconciliation / correction; default today.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ actual_bank_balance_ore, date }) =>
      run(async () => {
        const r = await client.reconcile(actual_bank_balance_ore, date);
        return {
          date: r.date,
          computed_likvider_before: money(r.likviderOre),
          bank_balance: money(r.actualOre),
          difference: money(r.differenceOre),
          booked: r.movement
            ? { correction_movement_id: r.movement.id, amount: money(r.movement.amountOre), description: r.movement.description }
            : null,
          likvider_after: money(r.actualOre),
          result: r.movement ? 'A correction was booked for the difference; likvider now equals the bank.' : 'Figures already agreed; nothing booked.',
          audit: 'reconciliation logged as actor api'
        };
      })
  );

  server.registerTool(
    'create_draft_invoice',
    {
      title: 'Create draft invoice',
      description:
        `Creates a DRAFT invoice for a customer with the given lines. Drafts have no number and nothing legal happens. ${HUMAN_ONLY} Use list_customers and list_accounts to resolve ids. Amounts are integer øre ex VAT; VAT (25 %) is computed by the app unless vat_exempt_reason is given. Audit-logged with actor "api".`,
      inputSchema: {
        customer_id: z.number().int().positive().describe('Customer id from list_customers.'),
        lines: z
          .array(
            z.object({
              description: z.string().trim().min(1).max(500),
              quantity: z.number().refine((n) => n !== 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Max two decimals, not 0'),
              unit: z.string().trim().min(1).max(30).describe('e.g. "time", "stk."'),
              unit_price_ore: posOreInt.describe('Unit price ex VAT in integer øre.'),
              account_id: z.number().int().positive().optional().describe('Revenue account id (list_accounts type revenue); default 1000 Konsulentydelser.')
            })
          )
          .min(1)
          .max(200),
        issue_date: isoDate.optional().describe('Fakturadato; default today.'),
        due_date: isoDate.optional().describe('Forfaldsdato; default: issue date plus the customer\'s payment terms.'),
        payment_reference: z.string().trim().max(300).optional().describe('Text the customer writes on the transfer; default "Faktura <nr>" at issue.'),
        vat_exempt_reason: z.string().trim().min(1).max(300).optional().describe('Set to make the invoice VAT-free with this statutory reason printed, e.g. "Omvendt betalingspligt, jf. momslovens § 46".')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ customer_id, lines, issue_date, due_date, payment_reference, vat_exempt_reason }) =>
      run(async () => {
        const body: Parameters<FakturaClient['createDraft']>[0] = {
          customerId: customer_id,
          lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPriceOre: l.unit_price_ore, accountId: l.account_id }))
        };
        if (issue_date) body.issueDate = issue_date;
        if (due_date) body.dueDate = due_date;
        if (payment_reference !== undefined) body.paymentReference = payment_reference;
        if (vat_exempt_reason) body.vatExemptReason = vat_exempt_reason;
        const d = await client.createDraft(body);
        return {
          created: 'draft invoice (no number assigned)',
          draft_id: d.id,
          customer: d.customerName,
          issue_date: d.issueDate,
          due_date: d.dueDate,
          lines: d.lines.length,
          subtotal: money(d.subtotalOre),
          vat: money(d.vatOre),
          total: money(d.totalOre),
          open_in_app: `/fakturaer/${d.id}`,
          next_step: `The draft must be reviewed and issued (Udsted) by the owner in the app UI; that is when it gets its number and PDF. ${HUMAN_ONLY}`,
          audit: 'logged as actor api'
        };
      })
  );

  server.registerTool(
    'create_expense',
    {
      title: 'Create expense',
      description:
        'Creates an expense (udgift) row with the next voucher number: date, supplier, description, cost account, amount ex VAT and VAT (entered, not derived: foreign purchases and repræsentation break the 25 % assumption). The bilag file (PDF/JPG/PNG) must be attached by the owner in the app UI afterwards. Audit-logged with actor "api".',
      inputSchema: {
        date: isoDate.describe('Voucher date, ISO.'),
        supplier: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(500),
        account_id: z.number().int().positive().describe('Cost account id from list_accounts (type cost).'),
        amount_ex_vat_ore: oreInt.describe('Amount ex VAT, integer øre.'),
        vat_ore: oreInt.describe('VAT amount, integer øre (0 for VAT-free/foreign).'),
        paid_date: isoDate.optional().describe('Set if already paid.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ date, supplier, description, account_id, amount_ex_vat_ore, vat_ore, paid_date }) =>
      run(async () => {
        const e = await client.createExpense({ date, supplier, description, accountId: account_id, amountExVatOre: amount_ex_vat_ore, vatOre: vat_ore, paidDate: paid_date ?? null });
        const accounts = new Map((await client.listAccounts()).map((a) => [a.id, a]));
        return {
          created: 'expense',
          ...expenseSummary(e, accounts),
          open_in_app: `/udgifter/${e.id}`,
          next_step: 'Attach the bilag (receipt/invoice file) to this voucher in the app UI; the row has no file yet.',
          audit: 'logged as actor api'
        };
      })
  );

  // ------------------------------------------------------------------ lookups

  server.registerTool(
    'list_accounts',
    {
      title: 'List accounts (kontoplan)',
      description: 'The chart of accounts: id, number, name and type (revenue | cost). Use the ids for create_draft_invoice (revenue) and create_expense (cost).',
      inputSchema: { type: z.enum(['revenue', 'cost']).optional().describe('Filter by type.') },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ type }) =>
      run(async () => {
        const rows = await client.listAccounts();
        const list = (type ? rows.filter((a) => a.type === type) : rows).map((a) => ({ id: a.id, number: a.number, name: a.name, type: a.type }));
        return { count: list.length, accounts: list };
      })
  );

  server.registerTool(
    'list_customers',
    {
      title: 'List customers',
      description: 'Customers with id, name, address, CVR, e-mail and payment terms (days; null = the app default). Use the id for create_draft_invoice.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () =>
      run(async () => {
        const rows = await client.listCustomers();
        return {
          count: rows.length,
          customers: rows.map((c) => ({
            id: c.id,
            name: c.name,
            address: c.address,
            zip: c.zip,
            city: c.city,
            country: c.country,
            cvr: c.cvr,
            email: c.email,
            payment_terms_days: c.paymentTermsDays
          }))
        };
      })
  );
}
