import { and, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db';
import { expense, invoice } from '../schema';
import { quarterRange } from '../../format';
import { listInvoices, type InvoiceListRow } from './invoices';
import { listExpenses, type ExpenseRow } from './expenses';

export interface VatReport {
  year: number;
  quarter: number;
  from: string;
  to: string;
  /** Salgsmoms: sum of vat_ore on issued/credited invoices by issue_date (credit notes net out). */
  salesVatOre: number;
  /** Købsmoms: sum of expense vat_ore by date. */
  purchaseVatOre: number;
  /** Momstilsvar = salgsmoms - købsmoms. */
  netVatOre: number;
  salesExVatOre: number;
  purchasesExVatOre: number;
  salesRows: InvoiceListRow[];
  purchaseRows: ExpenseRow[];
}

export function vatReport(year: number, quarter: number): VatReport {
  const { from, to } = quarterRange(year, quarter);
  const salesRows = listInvoices()
    .filter((r) => r.status !== 'draft' && r.issueDate >= from && r.issueDate <= to)
    .sort((a, b) => (a.invoiceNumber ?? 0) - (b.invoiceNumber ?? 0));
  const purchaseRows = listExpenses()
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.voucherNumber - b.voucherNumber);

  const salesVatOre = salesRows.reduce((s, r) => s + r.vatOre, 0);
  const salesExVatOre = salesRows.reduce((s, r) => s + r.subtotalOre, 0);
  const purchaseVatOre = purchaseRows.reduce((s, r) => s + r.vatOre, 0);
  const purchasesExVatOre = purchaseRows.reduce((s, r) => s + r.amountExVatOre, 0);

  return {
    year,
    quarter,
    from,
    to,
    salesVatOre,
    purchaseVatOre,
    netVatOre: salesVatOre - purchaseVatOre,
    salesExVatOre,
    purchasesExVatOre,
    salesRows,
    purchaseRows
  };
}

/** Year-to-date totals for the dashboard. */
export function yearTotals(year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const inv = db
    .select({ subtotalOre: invoice.subtotalOre, vatOre: invoice.vatOre, totalOre: invoice.totalOre })
    .from(invoice)
    .where(and(inArray(invoice.status, ['issued', 'credited']), gte(invoice.issueDate, from), lte(invoice.issueDate, to)))
    .all();
  const exp = db
    .select({ amountExVatOre: expense.amountExVatOre, vatOre: expense.vatOre })
    .from(expense)
    .where(and(gte(expense.date, from), lte(expense.date, to)))
    .all();
  const revenueExVatOre = inv.reduce((s, r) => s + r.subtotalOre, 0);
  const salesVatOre = inv.reduce((s, r) => s + r.vatOre, 0);
  const expensesExVatOre = exp.reduce((s, r) => s + r.amountExVatOre, 0);
  const purchaseVatOre = exp.reduce((s, r) => s + r.vatOre, 0);
  return {
    year,
    revenueExVatOre,
    expensesExVatOre,
    resultExVatOre: revenueExVatOre - expensesExVatOre,
    salesVatOre,
    purchaseVatOre,
    netVatOre: salesVatOre - purchaseVatOre,
    invoiceCount: inv.length,
    expenseCount: exp.length
  };
}
