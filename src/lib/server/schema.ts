import { sqliteTable, text, integer, real, uniqueIndex, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const customer = sqliteTable('customer', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  address: text('address').notNull(),
  zip: text('zip').notNull(),
  city: text('city').notNull(),
  country: text('country').notNull().default('DK'),
  cvr: text('cvr'),
  email: text('email').notNull().default(''),
  createdAt: text('created_at').notNull()
});

export const invoice = sqliteTable(
  'invoice',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceNumber: integer('invoice_number'),
    status: text('status', { enum: ['draft', 'issued', 'credited'] }).notNull().default('draft'),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customer.id),
    issueDate: text('issue_date').notNull(),
    dueDate: text('due_date').notNull(),
    currency: text('currency').notNull().default('DKK'),
    subtotalOre: integer('subtotal_ore').notNull().default(0),
    vatOre: integer('vat_ore').notNull().default(0),
    totalOre: integer('total_ore').notNull().default(0),
    vatRateBp: integer('vat_rate_bp').notNull().default(2500),
    vatExemptReason: text('vat_exempt_reason'),
    paymentReference: text('payment_reference').notNull().default(''),
    paidDate: text('paid_date'),
    pdfPath: text('pdf_path'),
    creditedByInvoiceId: integer('credited_by_invoice_id').references((): AnySQLiteColumn => invoice.id),
    createdAt: text('created_at').notNull()
  },
  (t) => [
    uniqueIndex('invoice_number_unique').on(t.invoiceNumber),
    index('invoice_customer_idx').on(t.customerId),
    index('invoice_issue_date_idx').on(t.issueDate),
    index('invoice_status_idx').on(t.status),
    // one credit note credits exactly one original
    uniqueIndex('invoice_credited_by_unique').on(t.creditedByInvoiceId).where(sql`credited_by_invoice_id IS NOT NULL`)
  ]
);

export const invoiceLine = sqliteTable(
  'invoice_line',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoice.id),
    description: text('description').notNull(),
    quantity: real('quantity').notNull(),
    unit: text('unit').notNull(),
    unitPriceOre: integer('unit_price_ore').notNull(),
    lineTotalOre: integer('line_total_ore').notNull()
  },
  (t) => [index('invoice_line_invoice_idx').on(t.invoiceId)]
);

export const expense = sqliteTable(
  'expense',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    voucherNumber: integer('voucher_number').notNull(),
    date: text('date').notNull(),
    supplier: text('supplier').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    amountExVatOre: integer('amount_ex_vat_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    amountInclOre: integer('amount_incl_ore').notNull(),
    paidDate: text('paid_date'),
    filePath: text('file_path'),
    createdAt: text('created_at').notNull()
  },
  (t) => [uniqueIndex('expense_voucher_unique').on(t.voucherNumber), index('expense_date_idx').on(t.date)]
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: text('timestamp').notNull(),
    entity: text('entity').notNull(),
    entityId: integer('entity_id').notNull(),
    action: text('action').notNull(),
    detailJson: text('detail_json').notNull()
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)]
);

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
});

export type AnyTable = typeof customer | typeof invoice | typeof invoiceLine | typeof expense | typeof auditLog;
export type Customer = typeof customer.$inferSelect;
export type Invoice = typeof invoice.$inferSelect;
export type InvoiceLine = typeof invoiceLine.$inferSelect;
export type Expense = typeof expense.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
