/**
 * Finance views. No posting engine: invoices, expenses and cash movements are
 * the source records; these are queries over them. P&L and VAT run on accrual
 * dates (issue_date / expense date); the cash views run on paid_date and
 * movement date.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { account, cashMovement, expense, invoice, invoiceLine, type Account } from '../schema';
import { formatDate, formatOre, monthOf, nextMonth, quarterOf, quarterRange, todayIso, vatSettlementDate } from '../../format';
import { getSettings } from './settings';
import { listInvoices } from './invoices';
import { listMovementsAsc } from './cash';
import { badRequest, conflict } from '../errors';
import { createMovement } from './cash';

const ISSUED = ['issued', 'credited'] as const;

export interface AccountTotal {
  account: Account;
  totalOre: number;
}

export interface Resultat {
  year: number;
  quarter: number | null;
  from: string;
  to: string;
  revenue: AccountTotal[];
  costs: AccountTotal[];
  revenueOre: number;
  costsOre: number;
  resultOre: number;
}

/** Revenue per revenue account (issued invoices ex VAT, credit notes netting out) and costs per cost account (expenses ex VAT). Accrual basis. */
export function resultat(year: number, quarter: number | null): Resultat {
  const range = quarter ? quarterRange(year, quarter) : { from: `${year}-01-01`, to: `${year}-12-31` };
  const accounts = db.select().from(account).orderBy(asc(account.number)).all();

  const revenueRows = db
    .select({ accountId: invoiceLine.accountId, total: sql<number>`coalesce(sum(${invoiceLine.lineTotalOre}), 0)` })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
    .where(and(inArray(invoice.status, [...ISSUED]), gte(invoice.issueDate, range.from), lte(invoice.issueDate, range.to)))
    .groupBy(invoiceLine.accountId)
    .all();
  const costRows = db
    .select({ accountId: expense.accountId, total: sql<number>`coalesce(sum(${expense.amountExVatOre}), 0)` })
    .from(expense)
    .where(and(gte(expense.date, range.from), lte(expense.date, range.to)))
    .groupBy(expense.accountId)
    .all();

  const byId = (rows: { accountId: number; total: number }[]) => new Map(rows.map((r) => [r.accountId, r.total]));
  const rev = byId(revenueRows);
  const cost = byId(costRows);
  const revenue = accounts.filter((a) => a.type === 'revenue').map((a) => ({ account: a, totalOre: rev.get(a.id) ?? 0 }));
  const costs = accounts.filter((a) => a.type === 'cost').map((a) => ({ account: a, totalOre: cost.get(a.id) ?? 0 }));
  const revenueOre = revenue.reduce((s, r) => s + r.totalOre, 0);
  const costsOre = costs.reduce((s, r) => s + r.totalOre, 0);
  return { year, quarter, from: range.from, to: range.to, revenue, costs, revenueOre, costsOre, resultOre: revenueOre - costsOre };
}

export interface CashflowMonth {
  month: string; // yyyy-mm
  /** closed = fully in the past (actuals only); current = this month (actuals to date plus forecast); forecast = future. */
  kind: 'closed' | 'current' | 'forecast';
  invoicesInOre: number;
  movementsInOre: number;
  inOre: number;
  expensesOutOre: number;
  creditNotesOutOre: number;
  movementsOutOre: number;
  outOre: number;
  netOre: number;
  /** Running position on actual (paid) flows only. */
  positionOre: number;
  forecastInOre: number;
  forecastOutOre: number;
  /** Running position including the forecast; equals positionOre for closed months. */
  projectedPositionOre: number;
}

export type ForecastKind = 'invoices' | 'expenses' | 'credit_notes' | 'vat';

export interface ForecastItem {
  month: string;
  kind: ForecastKind;
  label: string;
  detail: string;
  /** Signed: positive = expected in, negative = expected out. */
  amountOre: number;
}

export interface Forecast {
  /** The current month; every forecast item lands here or later (overdue items are expected now). */
  fromMonth: string;
  toMonth: string;
  items: ForecastItem[];
  invoicesInOre: number;
  expensesOutOre: number;
  creditNotesOutOre: number;
  /** Positive = VAT still to be paid, negative = VAT refund expected. */
  vatOutOre: number;
  netOre: number;
  /** Bank position at the end of toMonth if everything expected happens. */
  projectedPositionOre: number;
}

export interface Cashflow {
  openingBalanceOre: number;
  openingBalanceDate: string;
  months: CashflowMonth[];
  /** Open issued invoices grouped by due month. */
  expected: { month: string; totalOre: number; count: number }[];
  forecast: Forecast;
  /** Actual position today: opening balance plus every paid flow and movement. */
  closingPositionOre: number;
  /** Paid flows and movements dated before the opening balance date: already inside that balance, so not counted. */
  excludedBeforeOpening: { count: number; netOre: number };
}

/** Unrefunded credit notes whose original was paid: money owed back to customers. */
function owedCreditNotes(): { invoiceNumber: number; creditsNumber: number | null; totalOre: number }[] {
  return db
    .select({
      invoiceNumber: invoice.invoiceNumber,
      totalOre: invoice.totalOre,
      // Literal outer reference: in a single-table select drizzle renders ${invoice.id} unqualified, which the subquery would resolve as o.id.
      creditsNumber: sql<number | null>`(select o.invoice_number from invoice o where o.credited_by_invoice_id = invoice.id)`
    })
    .from(invoice)
    .where(
      and(
        eq(invoice.status, 'issued'),
        sql`${invoice.paidDate} IS NULL`,
        sql`exists (select 1 from invoice o where o.credited_by_invoice_id = ${invoice.id} and o.paid_date is not null)`
      )
    )
    .all()
    .map((r) => ({ invoiceNumber: r.invoiceNumber as number, creditsNumber: r.creditsNumber, totalOre: r.totalOre }));
}

export interface VatOutstanding {
  /** Momstilsvar accrued for every quarter up to and including the current one. */
  accruedVatOre: number;
  /** Sum of vat_payment movements: negative when paid, positive when refunded. */
  vatPaymentsOre: number;
  /** accrued + payments: what is still owed (negative = owed back). */
  skyldigMomsOre: number;
  /**
   * The outstanding amount split on quarters, newest first, so the forecast can date it: payments are assumed to
   * have settled the oldest quarters first. `provisional` marks the running quarter, which is still accruing.
   */
  items: { year: number; quarter: number; amountOre: number; dueDate: string; provisional: boolean }[];
}

/** Skyldig moms and which settlement dates it is expected on. */
export function vatOutstanding(asOf = todayIso()): VatOutstanding {
  const current = quarterOf(asOf);
  const { to } = quarterRange(current.year, current.quarter);
  const vatSum = (from: string | null, until: string) => {
    const sales =
      db
        .select({ v: sql<number>`coalesce(sum(${invoice.vatOre}), 0)` })
        .from(invoice)
        .where(and(inArray(invoice.status, [...ISSUED]), from ? gte(invoice.issueDate, from) : undefined, lte(invoice.issueDate, until)))
        .get()?.v ?? 0;
    const purchases =
      db
        .select({ v: sql<number>`coalesce(sum(${expense.vatOre}), 0)` })
        .from(expense)
        .where(and(from ? gte(expense.date, from) : undefined, lte(expense.date, until)))
        .get()?.v ?? 0;
    return sales - purchases;
  };
  const accruedVatOre = vatSum(null, to);
  const vatPaymentsOre =
    db
      .select({ v: sql<number>`coalesce(sum(${cashMovement.amountOre}), 0)` })
      .from(cashMovement)
      .where(eq(cashMovement.kind, 'vat_payment'))
      .get()?.v ?? 0;
  const skyldigMomsOre = accruedVatOre + vatPaymentsOre;

  const items: VatOutstanding['items'] = [];
  const firstDate = [
    db.select({ d: sql<string | null>`min(${invoice.issueDate})` }).from(invoice).where(inArray(invoice.status, [...ISSUED])).get()?.d,
    db.select({ d: sql<string | null>`min(${expense.date})` }).from(expense).get()?.d
  ]
    .filter((d): d is string => !!d)
    .sort()[0];
  if (skyldigMomsOre > 0 && firstDate) {
    // Walk quarters from the current one backwards; the oldest are the ones most likely already settled.
    let remaining = skyldigMomsOre;
    const first = quarterOf(firstDate);
    let y = current.year;
    let q = current.quarter;
    while (remaining > 0 && (y > first.year || (y === first.year && q >= first.quarter))) {
      const r = quarterRange(y, q);
      const net = vatSum(r.from, r.to);
      if (net > 0) {
        const take = Math.min(net, remaining);
        items.push({ year: y, quarter: q, amountOre: take, dueDate: vatSettlementDate(y, q), provisional: y === current.year && q === current.quarter });
        remaining -= take;
      }
      if (q === 1) {
        y -= 1;
        q = 4;
      } else q -= 1;
    }
    if (remaining > 0) {
      // Payments smaller than the positive quarters explain: attach the rest to the newest quarter.
      const head = items[0] ?? { year: current.year, quarter: current.quarter, amountOre: 0, dueDate: vatSettlementDate(current.year, current.quarter), provisional: true };
      if (!items.length) items.push(head);
      head.amountOre += remaining;
    }
  } else if (skyldigMomsOre < 0) {
    items.push({ year: current.year, quarter: current.quarter, amountOre: skyldigMomsOre, dueDate: vatSettlementDate(current.year, current.quarter), provisional: true });
  }
  return { accruedVatOre, vatPaymentsOre, skyldigMomsOre, items };
}

/**
 * One row per month from the opening-balance month through the forecast horizon. Closed months carry actual
 * (paid) flows with a running bank position; the current and future months add the forecast: open invoices by
 * due month, unpaid expenses, credit notes owed back and VAT by settlement date, overdue items landing in the
 * current month. The projected position runs on both.
 */
export function cashflow(): Cashflow {
  const s = getSettings();
  const openingBalanceOre = Number(s.opening_balance_ore) || 0;
  const openingBalanceDate = s.opening_balance_date;
  const today = todayIso();
  const currentMonth = monthOf(today);
  const bucket = (iso: string) => (monthOf(iso) < currentMonth ? currentMonth : monthOf(iso));

  // Every issued document with a paid_date moved money: invoices in, refunded credit notes (negative totals) out,
  // and originals that were paid before being credited still came in on their paid date.
  const excluded = { count: 0, netOre: 0 };
  const sinceOpening = <T extends { date: string; netOre: number }>(rows: T[]): T[] =>
    rows.filter((r) => {
      if (r.date >= openingBalanceDate) return true;
      excluded.count += 1;
      excluded.netOre += r.netOre;
      return false;
    });
  const paidInvoices = sinceOpening(
    db
      .select({ paidDate: invoice.paidDate, totalOre: invoice.totalOre })
      .from(invoice)
      .where(and(inArray(invoice.status, [...ISSUED]), isNotNull(invoice.paidDate)))
      .all()
      .map((r) => ({ date: r.paidDate as string, netOre: r.totalOre, totalOre: r.totalOre }))
  );
  const paidExpenses = sinceOpening(
    db
      .select({ paidDate: expense.paidDate, totalOre: expense.amountInclOre })
      .from(expense)
      .where(isNotNull(expense.paidDate))
      .all()
      .map((r) => ({ date: r.paidDate as string, netOre: -r.totalOre, totalOre: r.totalOre }))
  );
  const movements = sinceOpening(listMovementsAsc().map((m) => ({ ...m, netOre: m.amountOre })));

  const months = new Map<string, CashflowMonth>();
  const ensure = (ym: string) => {
    let row = months.get(ym);
    if (!row) {
      row = {
        month: ym,
        kind: ym < currentMonth ? 'closed' : ym === currentMonth ? 'current' : 'forecast',
        invoicesInOre: 0,
        movementsInOre: 0,
        inOre: 0,
        expensesOutOre: 0,
        creditNotesOutOre: 0,
        movementsOutOre: 0,
        outOre: 0,
        netOre: 0,
        positionOre: 0,
        forecastInOre: 0,
        forecastOutOre: 0,
        projectedPositionOre: 0
      };
      months.set(ym, row);
    }
    return row;
  };
  for (const p of paidInvoices) {
    const row = ensure(monthOf(p.date));
    if (p.totalOre >= 0) row.invoicesInOre += p.totalOre;
    else row.creditNotesOutOre += -p.totalOre;
  }
  for (const e of paidExpenses) ensure(monthOf(e.date)).expensesOutOre += e.totalOre;
  for (const m of movements) {
    const row = ensure(monthOf(m.date));
    if (m.amountOre >= 0) row.movementsInOre += m.amountOre;
    else row.movementsOutOre += -m.amountOre;
  }

  // Forecast items. Open invoices: by due month, overdue ones expected now.
  const items: ForecastItem[] = [];
  const openInvoices = listInvoices({ unpaidOnly: true });
  const expectedMap = new Map<string, { month: string; totalOre: number; count: number }>();
  const invoicesByMonth = new Map<string, typeof openInvoices>();
  for (const inv of openInvoices) {
    const ym = monthOf(inv.dueDate);
    const e = expectedMap.get(ym) ?? { month: ym, totalOre: 0, count: 0 };
    e.totalOre += inv.totalOre;
    e.count += 1;
    expectedMap.set(ym, e);
    const b = bucket(inv.dueDate);
    invoicesByMonth.set(b, [...(invoicesByMonth.get(b) ?? []), inv]);
  }
  for (const [ym, list] of invoicesByMonth) {
    const sorted = [...list].sort((a, b) => (a.invoiceNumber ?? 0) - (b.invoiceNumber ?? 0));
    items.push({
      month: ym,
      kind: 'invoices',
      label: list.length === 1 ? '1 åben faktura' : `${list.length} åbne fakturaer`,
      detail: sorted.map((i) => `${i.invoiceNumber}${i.dueDate < today ? ' (forfalden)' : ''}`).join(', '),
      amountOre: list.reduce((s, i) => s + i.totalOre, 0)
    });
  }
  // Unpaid expenses: no due date on record, so expected in their own month or now.
  const unpaidExpenses = db
    .select({ voucherNumber: expense.voucherNumber, date: expense.date, totalOre: expense.amountInclOre })
    .from(expense)
    .where(sql`${expense.paidDate} IS NULL`)
    .orderBy(asc(expense.date), asc(expense.voucherNumber))
    .all();
  const expensesByMonth = new Map<string, typeof unpaidExpenses>();
  for (const e of unpaidExpenses) {
    const b = bucket(e.date);
    expensesByMonth.set(b, [...(expensesByMonth.get(b) ?? []), e]);
  }
  for (const [ym, list] of expensesByMonth) {
    items.push({
      month: ym,
      kind: 'expenses',
      label: list.length === 1 ? '1 ubetalt udgift' : `${list.length} ubetalte udgifter`,
      detail: `bilag ${list.map((e) => e.voucherNumber).join(', ')}`,
      amountOre: -list.reduce((s, e) => s + e.totalOre, 0)
    });
  }
  // Credit notes owed back: expected now.
  for (const cn of owedCreditNotes()) {
    items.push({
      month: currentMonth,
      kind: 'credit_notes',
      label: `Kreditnota ${cn.invoiceNumber} til refusion`,
      detail: cn.creditsNumber ? `krediterer ${cn.creditsNumber}` : '',
      amountOre: cn.totalOre
    });
  }
  // VAT by settlement date.
  const vat = vatOutstanding(today);
  for (const v of vat.items) {
    items.push({
      month: bucket(v.dueDate),
      kind: 'vat',
      label: v.amountOre < 0 ? 'Moms til gode' : `Moms, ${v.quarter}. kvartal ${v.year}${v.provisional ? ' (foreløbig)' : ''}`,
      detail: `${v.amountOre < 0 ? 'afregning' : 'frist'} ${formatDate(v.dueDate)}${v.dueDate < today ? ' (overskredet)' : ''}`,
      amountOre: -v.amountOre
    });
  }
  const order: Record<ForecastKind, number> = { invoices: 0, expenses: 1, credit_notes: 2, vat: 3 };
  items.sort((a, b) => a.month.localeCompare(b.month) || order[a.kind] - order[b.kind]);
  for (const it of items) {
    const row = ensure(it.month);
    if (it.amountOre >= 0) row.forecastInOre += it.amountOre;
    else row.forecastOutOre += -it.amountOre;
  }

  const keys = [...months.keys()].sort();
  const first = monthOf(openingBalanceDate);
  let last = currentMonth;
  if (keys.length && keys[keys.length - 1] > last) last = keys[keys.length - 1];
  const rows: CashflowMonth[] = [];
  let position = openingBalanceOre;
  let projected = openingBalanceOre;
  for (let ym = first; ym <= last; ym = nextMonth(ym)) {
    const row = ensure(ym);
    row.inOre = row.invoicesInOre + row.movementsInOre;
    row.outOre = row.expensesOutOre + row.creditNotesOutOre + row.movementsOutOre;
    row.netOre = row.inOre - row.outOre;
    position += row.netOre;
    row.positionOre = position;
    projected += row.netOre + row.forecastInOre - row.forecastOutOre;
    row.projectedPositionOre = projected;
    rows.push(row);
  }

  const sumKind = (kind: ForecastKind) => items.filter((i) => i.kind === kind).reduce((s, i) => s + i.amountOre, 0);
  const forecast: Forecast = {
    fromMonth: currentMonth,
    toMonth: last,
    items,
    invoicesInOre: sumKind('invoices'),
    expensesOutOre: -sumKind('expenses'),
    creditNotesOutOre: -sumKind('credit_notes'),
    vatOutOre: -sumKind('vat'),
    netOre: items.reduce((s, i) => s + i.amountOre, 0),
    projectedPositionOre: projected
  };

  return {
    openingBalanceOre,
    openingBalanceDate,
    months: rows,
    expected: [...expectedMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    forecast,
    closingPositionOre: position,
    excludedBeforeOpening: excluded
  };
}

export interface Balance {
  asOf: string;
  likviderOre: number;
  debitorerOre: number;
  kreditorerOre: number;
  /** Unrefunded credit notes whose original was paid: money owed back to customers. */
  skyldigeKreditnotaerOre: number;
  skyldigMomsOre: number;
  nettoOre: number;
  accruedVatOre: number;
  vatPaymentsOre: number;
  openingBalanceOre: number;
  openInvoices: number;
  unpaidExpenses: number;
  openCreditNotes: number;
}

/** Position statement computed live: Likvider, Debitorer against Kreditorer and Skyldig moms. */
export function balance(): Balance {
  const asOf = todayIso();
  const cf = cashflow();
  const open = listInvoices({ unpaidOnly: true });
  const debitorerOre = open.reduce((s, r) => s + r.totalOre, 0);
  const unpaid = db.select({ totalOre: expense.amountInclOre }).from(expense).where(sql`${expense.paidDate} IS NULL`).all();
  const kreditorerOre = unpaid.reduce((s, r) => s + r.totalOre, 0);
  // Credit note (issued, unpaid) whose original had been paid -> the customer is owed the money back.
  const owed = owedCreditNotes();
  const skyldigeKreditnotaerOre = owed.reduce((s, r) => s - r.totalOre, 0);
  const { accruedVatOre, vatPaymentsOre, skyldigMomsOre } = vatOutstanding(asOf);

  return {
    asOf,
    likviderOre: cf.closingPositionOre,
    debitorerOre,
    kreditorerOre,
    skyldigeKreditnotaerOre,
    skyldigMomsOre,
    nettoOre: cf.closingPositionOre + debitorerOre - kreditorerOre - skyldigeKreditnotaerOre - skyldigMomsOre,
    accruedVatOre,
    vatPaymentsOre,
    openingBalanceOre: cf.openingBalanceOre,
    openInvoices: open.length,
    unpaidExpenses: unpaid.length,
    openCreditNotes: owed.length
  };
}

/** Afstemning step 1: compare the bank's figure with Likvider. */
export function reconcilePreview(actualOre: number): { likviderOre: number; actualOre: number; differenceOre: number } {
  if (!Number.isInteger(actualOre)) throw badRequest('Ugyldig saldo');
  const likviderOre = balance().likviderOre;
  return { likviderOre, actualOre, differenceOre: actualOre - likviderOre };
}

/**
 * Afstemning step 2: book a `correction` movement for the difference, audit-logged with the entered figure.
 * `expectedLikviderOre` is the figure the user saw in step 1; if Likvider moved meanwhile, refuse (409) so the
 * booked correction is always the one that was confirmed.
 */
export function reconcileBook(actualOre: number, expectedLikviderOre: number) {
  const preview = reconcilePreview(actualOre);
  if (!Number.isInteger(expectedLikviderOre)) throw badRequest('Ugyldig sammenligningssaldo');
  if (expectedLikviderOre !== preview.likviderOre) {
    throw conflict(`Likvider er ændret siden sammenligningen (${formatOre(preview.likviderOre)}). Sammenlign igen.`);
  }
  if (preview.differenceOre === 0) throw badRequest('Saldoen stemmer allerede; der er intet at bogføre');
  return createMovement(
    {
      date: todayIso(),
      description: `Afstemning mod bank: saldo ${formatOre(actualOre)}`,
      amountOre: preview.differenceOre,
      kind: 'correction'
    },
    { reconciliation: { enteredBalanceOre: actualOre, likviderOre: preview.likviderOre } }
  );
}
