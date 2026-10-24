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
  /** Days from invoice date to due date for this customer; null = the default under settings. */
  paymentTermsDays: integer('payment_terms_days'),
  /** Hourly rate ex VAT in øre, the default rate when this customer's logged time is put on a draft; null = none agreed. */
  hourlyRateOre: integer('hourly_rate_ore'),
  createdAt: text('created_at').notNull()
});

/**
 * Kontoplan. Seeded by migrations 0006 and 0012; accounts can be added, renamed, regrouped and archived, never
 * deleted while referenced. Number and type are immutable (trigger account_identity_immutable). `group` is a free
 * heading the reports subtotal on; archived accounts keep their history but are hidden from new records.
 */
export const account = sqliteTable(
  'account',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    type: text('type', { enum: ['revenue', 'cost'] }).notNull(),
    group: text('group_name').notNull().default(''),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [uniqueIndex('account_number_unique').on(t.number)]
);

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
    /** Date the document was sent to the customer; set once, only on issued documents (trigger invoice_sent_once). */
    sentAt: text('sent_at'),
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
    lineTotalOre: integer('line_total_ore').notNull(),
    /** Revenue account; 1 = 1000 Konsulentydelser (seeded id). */
    accountId: integer('account_id')
      .notNull()
      .default(1)
      .references(() => account.id),
    /**
     * manual = typed in the editor; time = generated from one time entry; time_group = a heading generated from its
     * time entries (quantity and total are their sums, the unit price is total / quantity rounded to whole øre, so
     * quantity × price may differ from the total by the rounding). Generated lines are rebuilt on every draft save.
     */
    kind: text('kind', { enum: ['manual', 'time', 'time_group'] }).notNull().default('manual')
  },
  (t) => [index('invoice_line_invoice_idx').on(t.invoiceId), index('invoice_line_account_idx').on(t.accountId)]
);

/** A heading on a draft that time entries are indented under; it becomes one invoice line. Frozen with the invoice. */
export const timeGroup = sqliteTable(
  'time_group',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoice.id),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('time_group_invoice_idx').on(t.invoiceId)]
);

/**
 * Logged time (tidsregistrering). The logged part (customer, date, minutes, description, billable) is locked once the
 * entry is on an invoice. The invoiced part (hours, description, rate) is filled when the entry is put on a draft,
 * editable while the invoice is a draft, and frozen at issue. standard_rate_ore is the customer's rate at that moment,
 * kept so the value of a write-up or write-down stays visible. Deleting the draft releases the entry; a credit note
 * does not.
 */
export const timeEntry = sqliteTable(
  'time_entry',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customer.id),
    date: text('date').notNull(),
    minutes: integer('minutes').notNull(),
    description: text('description').notNull(),
    billable: integer('billable', { mode: 'boolean' }).notNull().default(true),
    invoiceId: integer('invoice_id').references(() => invoice.id),
    groupId: integer('group_id').references(() => timeGroup.id),
    position: integer('position'),
    invoicedHours: real('invoiced_hours'),
    invoicedDescription: text('invoiced_description'),
    rateOre: integer('rate_ore'),
    standardRateOre: integer('standard_rate_ore'),
    createdAt: text('created_at').notNull()
  },
  (t) => [
    index('time_entry_customer_idx').on(t.customerId),
    index('time_entry_invoice_idx').on(t.invoiceId),
    index('time_entry_date_idx').on(t.date)
  ]
);

/** Suppliers (leverandører): created from the expense form's "new supplier" text, then picked from a list. Name only. */
export const supplier = sqliteTable(
  'supplier',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [uniqueIndex('supplier_name_unique').on(t.name)]
);

export const expense = sqliteTable(
  'expense',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    voucherNumber: integer('voucher_number').notNull(),
    date: text('date').notNull(),
    supplierId: integer('supplier_id')
      .notNull()
      .references(() => supplier.id),
    description: text('description').notNull(),
    /** Cost account; 11 = 2900 Øvrige omkostninger (seeded id). */
    accountId: integer('account_id')
      .notNull()
      .default(11)
      .references(() => account.id),
    amountExVatOre: integer('amount_ex_vat_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    amountInclOre: integer('amount_incl_ore').notNull(),
    paidDate: text('paid_date'),
    filePath: text('file_path'),
    createdAt: text('created_at').notNull()
  },
  (t) => [
    uniqueIndex('expense_voucher_unique').on(t.voucherNumber),
    index('expense_date_idx').on(t.date),
    index('expense_account_idx').on(t.accountId),
    index('expense_supplier_idx').on(t.supplierId)
  ]
);

/** Every bank movement that is not an invoice payment or an expense. Signed øre, positive = in. */
export const cashMovement = sqliteTable(
  'cash_movement',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    description: text('description').notNull(),
    amountOre: integer('amount_ore').notNull(),
    kind: text('kind', { enum: ['vat_payment', 'owner', 'tax', 'correction', 'other'] }).notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('cash_movement_date_idx').on(t.date)]
);

/** PDFs appended to the invoice document at issue (time sheets, product lists). Draft-only; locked with the invoice. */
export const invoiceAttachment = sqliteTable(
  'invoice_attachment',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoice.id),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    filePath: text('file_path').notNull(),
    pages: integer('pages').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('invoice_attachment_invoice_idx').on(t.invoiceId)]
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: text('timestamp').notNull(),
    entity: text('entity').notNull(),
    entityId: integer('entity_id').notNull(),
    action: text('action').notNull(),
    detailJson: text('detail_json').notNull(),
    /** Who caused the write: the browser UI (session cookie) or the JSON API with a bearer token (MCP). */
    actor: text('actor', { enum: ['ui', 'api'] }).notNull().default('ui')
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)]
);

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
});

export type AnyTable = typeof customer | typeof invoice | typeof invoiceLine | typeof expense | typeof auditLog | typeof account | typeof cashMovement | typeof invoiceAttachment | typeof supplier | typeof timeEntry | typeof timeGroup;
export type TimeEntry = typeof timeEntry.$inferSelect;
export type TimeGroup = typeof timeGroup.$inferSelect;
export type Customer = typeof customer.$inferSelect;
export type Supplier = typeof supplier.$inferSelect;
export type Account = typeof account.$inferSelect;
export type CashMovement = typeof cashMovement.$inferSelect;
export type Invoice = typeof invoice.$inferSelect;
export type InvoiceLine = typeof invoiceLine.$inferSelect;
export type Expense = typeof expense.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type InvoiceAttachment = typeof invoiceAttachment.$inferSelect;
