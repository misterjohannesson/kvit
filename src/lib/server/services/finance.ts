/**
 * Finance views. No posting engine: invoices, expenses and cash movements are
 * the source records; these are queries over them. P&L and VAT run on accrual
 * dates (issue_date / expense date); the cash views run on paid_date and
 * movement date.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { account, cashMovement, expense, invoice, invoiceLine, type Account } from '../schema';
import { quarterOf, quarterRange, todayIso } from '../../format';
import { getSettings } from './settings';
import { listInvoices } from './invoices';
import { listMovementsAsc } from './cash';
import { badRequest } from '../errors';
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
  invoicesInOre: number;
  movementsInOre: number;
  inOre: number;
  expensesOutOre: number;
  movementsOutOre: number;
  outOre: number;
  netOre: number;
  positionOre: number;
}

export interface Cashflow {
  openingBalanceOre: number;
  openingBalanceDate: string;
  months: CashflowMonth[];
  /** Open issued invoices grouped by due month. */
  expected: { month: string; totalOre: number; count: number }[];
  closingPositionOre: number;
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** One row per month from the opening-balance month to the latest of today and the last flow, with a running bank position. */
export function cashflow(): Cashflow {
  const s = getSettings();
  const openingBalanceOre = Number(s.opening_balance_ore) || 0;
  const openingBalanceDate = s.opening_balance_date;
  const today = todayIso();

  const paidInvoices = db
    .select({ paidDate: invoice.paidDate, totalOre: invoice.totalOre })
    .from(invoice)
    .where(and(eq(invoice.status, 'issued'), isNotNull(invoice.paidDate)))
    .all()
    .concat(
      // originals that were paid and later credited still moved money in on their paid date
      db
        .select({ paidDate: invoice.paidDate, totalOre: invoice.totalOre })
        .from(invoice)
        .where(and(eq(invoice.status, 'credited'), isNotNull(invoice.paidDate)))
        .all()
    );
  const paidExpenses = db
    .select({ paidDate: expense.paidDate, totalOre: expense.amountInclOre })
    .from(expense)
    .where(isNotNull(expense.paidDate))
    .all();
  const movements = listMovementsAsc();

  const months = new Map<string, CashflowMonth>();
  const ensure = (ym: string) => {
    let row = months.get(ym);
    if (!row) {
      row = { month: ym, invoicesInOre: 0, movementsInOre: 0, inOre: 0, expensesOutOre: 0, movementsOutOre: 0, outOre: 0, netOre: 0, positionOre: 0 };
      months.set(ym, row);
    }
    return row;
  };
  for (const p of paidInvoices) ensure(monthOf(p.paidDate as string)).invoicesInOre += p.totalOre;
  for (const e of paidExpenses) ensure(monthOf(e.paidDate as string)).expensesOutOre += e.totalOre;
  for (const m of movements) {
    const row = ensure(monthOf(m.date));
    if (m.amountOre >= 0) row.movementsInOre += m.amountOre;
    else row.movementsOutOre += -m.amountOre;
  }

  const keys = [...months.keys()].sort();
  let first = monthOf(openingBalanceDate);
  let last = monthOf(today);
  if (keys.length) {
    if (keys[0] < first) first = keys[0];
    if (keys[keys.length - 1] > last) last = keys[keys.length - 1];
  }
  const rows: CashflowMonth[] = [];
  let position = openingBalanceOre;
  for (let ym = first; ym <= last; ym = nextMonth(ym)) {
    const row = ensure(ym);
    row.inOre = row.invoicesInOre + row.movementsInOre;
    row.outOre = row.expensesOutOre + row.movementsOutOre;
    row.netOre = row.inOre - row.outOre;
    position += row.netOre;
    row.positionOre = position;
    rows.push(row);
  }

  const expectedMap = new Map<string, { month: string; totalOre: number; count: number }>();
  for (const inv of listInvoices({ unpaidOnly: true })) {
    const ym = monthOf(inv.dueDate);
    const e = expectedMap.get(ym) ?? { month: ym, totalOre: 0, count: 0 };
    e.totalOre += inv.totalOre;
    e.count += 1;
    expectedMap.set(ym, e);
  }

  return {
    openingBalanceOre,
    openingBalanceDate,
    months: rows,
    expected: [...expectedMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    closingPositionOre: position
  };
}

export interface Balance {
  asOf: string;
  likviderOre: number;
  debitorerOre: number;
  kreditorerOre: number;
  skyldigMomsOre: number;
  nettoOre: number;
  accruedVatOre: number;
  vatPaymentsOre: number;
  openingBalanceOre: number;
  openInvoices: number;
  unpaidExpenses: number;
}

/** Position statement computed live: Likvider, Debitorer against Kreditorer and Skyldig moms. */
export function balance(): Balance {
  const asOf = todayIso();
  const cf = cashflow();
  const open = listInvoices({ unpaidOnly: true });
  const debitorerOre = open.reduce((s, r) => s + r.totalOre, 0);
  const unpaid = db.select({ totalOre: expense.amountInclOre }).from(expense).where(sql`${expense.paidDate} IS NULL`).all();
  const kreditorerOre = unpaid.reduce((s, r) => s + r.totalOre, 0);

  // Accrued momstilsvar for every quarter up to and including the current one.
  const { to } = quarterRange(quarterOf(asOf).year, quarterOf(asOf).quarter);
  const salesVat = db
    .select({ v: sql<number>`coalesce(sum(${invoice.vatOre}), 0)` })
    .from(invoice)
    .where(and(inArray(invoice.status, [...ISSUED]), lte(invoice.issueDate, to)))
    .get()?.v ?? 0;
  const purchaseVat = db.select({ v: sql<number>`coalesce(sum(${expense.vatOre}), 0)` }).from(expense).where(lte(expense.date, to)).get()?.v ?? 0;
  const accruedVatOre = salesVat - purchaseVat;
  // vat_payment movements are negative when VAT is paid, positive when refunded.
  const vatPaymentsOre = db
    .select({ v: sql<number>`coalesce(sum(${cashMovement.amountOre}), 0)` })
    .from(cashMovement)
    .where(eq(cashMovement.kind, 'vat_payment'))
    .get()?.v ?? 0;
  const skyldigMomsOre = accruedVatOre + vatPaymentsOre;

  return {
    asOf,
    likviderOre: cf.closingPositionOre,
    debitorerOre,
    kreditorerOre,
    skyldigMomsOre,
    nettoOre: cf.closingPositionOre + debitorerOre - kreditorerOre - skyldigMomsOre,
    accruedVatOre,
    vatPaymentsOre,
    openingBalanceOre: cf.openingBalanceOre,
    openInvoices: open.length,
    unpaidExpenses: unpaid.length
  };
}

/** Afstemning step 1: compare the bank's figure with Likvider. */
export function reconcilePreview(actualOre: number): { likviderOre: number; actualOre: number; differenceOre: number } {
  if (!Number.isInteger(actualOre)) throw badRequest('Ugyldig saldo');
  const likviderOre = balance().likviderOre;
  return { likviderOre, actualOre, differenceOre: actualOre - likviderOre };
}

/** Afstemning step 2: book a `correction` movement for the difference, audit-logged with the entered figure. */
export function reconcileBook(actualOre: number) {
  const preview = reconcilePreview(actualOre);
  if (preview.differenceOre === 0) throw badRequest('Saldoen stemmer allerede; der er intet at bogføre');
  return createMovement(
    {
      date: todayIso(),
      description: `Afstemning mod bank: saldo ${(actualOre / 100).toFixed(2).replace('.', ',')} kr.`,
      amountOre: preview.differenceOre,
      kind: 'correction'
    },
    { reconciliation: { enteredBalanceOre: actualOre, likviderOre: preview.likviderOre } }
  );
}
