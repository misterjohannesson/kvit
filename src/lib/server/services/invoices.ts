import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db } from '../db';
import { customer, invoice, invoiceLine, type Customer, type Invoice, type InvoiceAttachment, type InvoiceLine } from '../schema';
import { attachmentBuffers, detachAllForDelete, listAttachments, mergePdfs } from './attachments';
import { audit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';
import { DATA_DIR, INVOICE_FILES_DIR } from '../env';
import { addDays, isValidIsoDate, lineTotalOre, roundOre, todayIso } from '../../format';
import { isoDate, oreAmount } from '../zod-shared';
import { companyDetailsComplete, getSettings, setSettingRaw } from './settings';
import { withIssueLock } from './issue-lock';
import { renderInvoicePdf } from '../pdf';
import { defaultRevenueAccountId, requireAccountOfType } from './accounts';

const lineSchema = z.object({
  description: z.string().trim().min(1, 'Beskrivelse er påkrævet').max(500),
  quantity: z.coerce
    .number({ error: 'Antal skal være et tal' })
    .refine((n) => Number.isFinite(n) && n !== 0 && Math.abs(n) <= 1e9, 'Antal skal være forskelligt fra 0')
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Antal kan højst have to decimaler'),
  unit: z.string().trim().min(1, 'Enhed er påkrævet').max(30),
  unitPriceOre: oreAmount('Pris'),
  /** Revenue account; omitted -> 1000 Konsulentydelser (resolved by number, see defaultRevenueAccountId). */
  accountId: z.coerce.number({ error: 'Konto skal være et tal' }).int('Ugyldig konto').positive('Ugyldig konto').optional()
});

const draftSchema = z.object({
  customerId: z.coerce.number({ error: 'Kunde skal vælges' }).int('Ugyldig kunde').positive('Ugyldig kunde'),
  issueDate: isoDate,
  dueDate: isoDate,
  vatExemptReason: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  paymentReference: z.string().trim().max(300).default(''),
  lines: z.array(lineSchema).max(200).default([])
});

export const VAT_RATE_BP = 2500;

export interface InvoiceListRow extends Invoice {
  customerName: string;
  isCreditNote: boolean;
  /** Original invoice number if this is a credit note. */
  creditsInvoiceNumber: number | null;
  creditedByNumber: number | null;
}

export interface InvoiceDetail extends InvoiceListRow {
  customer: Customer;
  lines: InvoiceLine[];
  creditsInvoiceId: number | null;
  /** For a credit note: the paid date of the original it credits (money to be refunded when set). */
  originalPaidDate: string | null;
  /** PDFs appended to the document at issue, in order. */
  attachments: InvoiceAttachment[];
}

export const computeLineTotalOre = lineTotalOre;

export function computeTotals(lines: { lineTotalOre: number }[], vatExempt: boolean) {
  const subtotalOre = lines.reduce((s, l) => s + l.lineTotalOre, 0);
  const vatRateBp = vatExempt ? 0 : VAT_RATE_BP;
  const vatOre = vatExempt ? 0 : roundOre((subtotalOre * VAT_RATE_BP) / 10000);
  return { subtotalOre, vatOre, totalOre: subtotalOre + vatOre, vatRateBp };
}

const original = sql`(select o.invoice_number from invoice o where o.credited_by_invoice_id = ${invoice.id})`;
const creditedBy = sql`(select c.invoice_number from invoice c where c.id = ${invoice.creditedByInvoiceId})`;

function listQuery() {
  return db
    .select({
      inv: invoice,
      customerName: customer.name,
      creditsInvoiceNumber: sql<number | null>`${original}`,
      creditedByNumber: sql<number | null>`${creditedBy}`
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId));
}

function toRow(r: {
  inv: Invoice;
  customerName: string;
  creditsInvoiceNumber: number | null;
  creditedByNumber: number | null;
}): InvoiceListRow {
  return {
    ...r.inv,
    customerName: r.customerName,
    isCreditNote: r.creditsInvoiceNumber !== null,
    creditsInvoiceNumber: r.creditsInvoiceNumber,
    creditedByNumber: r.creditedByNumber
  };
}

export function listInvoices(filter: { status?: string; year?: number; unpaidOnly?: boolean } = {}): InvoiceListRow[] {
  const conds = [];
  if (filter.status && ['draft', 'issued', 'credited'].includes(filter.status)) {
    conds.push(eq(invoice.status, filter.status as Invoice['status']));
  }
  if (filter.year) {
    conds.push(gte(invoice.issueDate, `${filter.year}-01-01`));
    conds.push(lte(invoice.issueDate, `${filter.year}-12-31`));
  }
  const rows = listQuery()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invoice.issueDate), desc(invoice.invoiceNumber), desc(invoice.id))
    .all()
    .map(toRow);
  if (filter.unpaidOnly) {
    return rows.filter((r) => r.status === 'issued' && !r.isCreditNote && !r.paidDate);
  }
  return rows;
}

export function listInvoiceYears(): number[] {
  const rows = db
    .select({ y: sql<string>`substr(${invoice.issueDate}, 1, 4)` })
    .from(invoice)
    .groupBy(sql`substr(${invoice.issueDate}, 1, 4)`)
    .orderBy(desc(sql`substr(${invoice.issueDate}, 1, 4)`))
    .all();
  return rows.map((r) => Number(r.y));
}

export function getInvoice(id: number): InvoiceDetail {
  const r = listQuery().where(eq(invoice.id, id)).get();
  if (!r) throw notFound('Faktura findes ikke');
  const row = toRow(r);
  const cust = db.select().from(customer).where(eq(customer.id, row.customerId)).get();
  if (!cust) throw notFound('Kunde findes ikke');
  const lines = db.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, id)).orderBy(asc(invoiceLine.id)).all();
  const orig = db
    .select({ id: invoice.id, paidDate: invoice.paidDate })
    .from(invoice)
    .where(eq(invoice.creditedByInvoiceId, id))
    .get();
  return { ...row, customer: cust, lines, creditsInvoiceId: orig?.id ?? null, originalPaidDate: orig?.paidDate ?? null, attachments: listAttachments(id) };
}

/** Detail by invoice number (issued documents only; drafts have no number). */
export function getInvoiceByNumber(invoiceNumber: number): InvoiceDetail {
  const row = db.select({ id: invoice.id }).from(invoice).where(eq(invoice.invoiceNumber, invoiceNumber)).get();
  if (!row) throw notFound(`Faktura ${invoiceNumber} findes ikke`);
  return getInvoice(row.id);
}

function assertDraft(inv: Invoice): void {
  if (inv.status !== 'draft') {
    throw conflict(`Faktura ${inv.invoiceNumber ?? inv.id} er udstedt og kan ikke ændres. Opret en kreditnota i stedet.`);
  }
}

export function createDraft(input: { customerId: number }): InvoiceDetail {
  const s = getSettings();
  const cust = db.select().from(customer).where(eq(customer.id, Number(input.customerId))).get();
  if (!cust) throw badRequest('Vælg en kunde');
  const today = todayIso();
  const terms = cust.paymentTermsDays ?? (Number(s.payment_terms_days) || 0);
  // Reference text for the customer's bank transfer; empty becomes "Faktura <nr.>" at issue.
  const paymentReference = '';
  return db.transaction(() => {
    const row = db
      .insert(invoice)
      .values({
        status: 'draft',
        customerId: cust.id,
        issueDate: today,
        dueDate: addDays(today, terms),
        paymentReference,
        createdAt: new Date().toISOString()
      })
      .returning()
      .get();
    audit('invoice', row.id, 'create', { customerId: cust.id });
    return getInvoice(row.id);
  });
}

/**
 * Replace draft fields and lines. 409 if the invoice is not a draft.
 * Runs under the issue lock so an edit can never interleave with an issue in
 * progress (PDF rendered from one state, number assigned to another).
 */
type DraftData = z.infer<typeof draftSchema>;

/** Validate draft input before anything is written: 400 with every message at once. */
function parseDraftInput(input: unknown): DraftData {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  if (parsed.data.dueDate < parsed.data.issueDate) throw badRequest('Forfaldsdato kan ikke ligge før fakturadatoen');
  return parsed.data;
}

/** Replace header fields and lines of draft `id`. Must run inside a transaction under the issue lock. */
function applyDraft(id: number, data: DraftData): void {
  const inv = db.select().from(invoice).where(eq(invoice.id, id)).get();
  if (!inv) throw notFound('Faktura findes ikke');
  assertDraft(inv);
  const cust = db.select().from(customer).where(eq(customer.id, data.customerId)).get();
  if (!cust) throw badRequest('Kunden findes ikke');

  const fallbackAccount = data.lines.some((l) => l.accountId === undefined) ? defaultRevenueAccountId() : 0;
  const lines = data.lines.map((l) => {
    const accountId = l.accountId ?? fallbackAccount;
    requireAccountOfType(accountId, 'revenue');
    return {
      invoiceId: id,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceOre: l.unitPriceOre,
      lineTotalOre: computeLineTotalOre(l.quantity, l.unitPriceOre),
      accountId
    };
  });
  const totals = computeTotals(lines, data.vatExemptReason !== null);

  db.delete(invoiceLine).where(eq(invoiceLine.invoiceId, id)).run();
  if (lines.length) db.insert(invoiceLine).values(lines).run();
  db.update(invoice)
    .set({
      customerId: data.customerId,
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      vatExemptReason: data.vatExemptReason,
      paymentReference: data.paymentReference,
      ...totals
    })
    .where(eq(invoice.id, id))
    .run();
  audit('invoice', id, 'update', { ...data, ...totals });
}

export async function updateDraft(id: number, input: unknown): Promise<InvoiceDetail> {
  // Immutability is checked before anything else: an issued invoice answers 409
  // to every mutation attempt, whatever the body looks like.
  const existing = db.select().from(invoice).where(eq(invoice.id, id)).get();
  if (!existing) throw notFound('Faktura findes ikke');
  assertDraft(existing);
  const data = parseDraftInput(input);
  return withIssueLock(async () =>
    db.transaction(() => {
      applyDraft(id, data);
      return getInvoice(id);
    })
  );
}

/**
 * Create a draft and fill it in one transaction (the API/MCP path). Input is
 * validated before any write, so a bad request leaves no row and no audit trace.
 */
export function createDraftWithContent(input: { customerId: unknown } & Record<string, unknown>): Promise<InvoiceDetail> {
  const customerId = strictId(input.customerId, 'customerId');
  const cust = db.select().from(customer).where(eq(customer.id, customerId)).get();
  if (!cust) throw badRequest('Kunden findes ikke');
  const today = todayIso();
  const terms = cust.paymentTermsDays ?? (Number(getSettings().payment_terms_days) || 0);
  const data = parseDraftInput({
    customerId,
    issueDate: input.issueDate ?? today,
    dueDate: input.dueDate ?? addDays(String(input.issueDate ?? today), terms),
    paymentReference: input.paymentReference ?? '',
    vatExemptReason: input.vatExemptReason ?? null,
    lines: input.lines ?? []
  });
  return withIssueLock(async () =>
    db.transaction(() => {
      const row = db
        .insert(invoice)
        .values({ status: 'draft', customerId, issueDate: data.issueDate, dueDate: data.dueDate, paymentReference: '', createdAt: new Date().toISOString() })
        .returning()
        .get();
      audit('invoice', row.id, 'create', { customerId });
      applyDraft(row.id, data);
      return getInvoice(row.id);
    })
  );
}

/** A positive integer id from JSON: numbers or digit strings only (no `true` -> 1, no `[5]` -> 5). */
export function strictId(raw: unknown, name: string): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${name} skal være et positivt heltal`);
  return n;
}

/** Drafts may be deleted. Issued invoices cannot: there is no code path for it. */
export function deleteDraft(id: number): Promise<void> {
  return withIssueLock(async () => {
    const files = db.transaction(() => {
      const inv = db.select().from(invoice).where(eq(invoice.id, id)).get();
      if (!inv) throw notFound('Faktura findes ikke');
      assertDraft(inv);
      const attachmentFiles = detachAllForDelete(id);
      db.delete(invoiceLine).where(eq(invoiceLine.invoiceId, id)).run();
      db.delete(invoice).where(eq(invoice.id, id)).run();
      audit('invoice', id, 'delete_draft', { attachments: attachmentFiles.length });
      return attachmentFiles;
    });
    for (const f of files) fs.rmSync(f, { force: true });
  });
}

/** Everything that ends up on the PDF. Compared again inside the issue transaction. */
function contentFingerprint(inv: InvoiceDetail): string {
  return JSON.stringify({
    customer: inv.customer,
    customerId: inv.customerId,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    vatExemptReason: inv.vatExemptReason,
    paymentReference: inv.paymentReference,
    subtotalOre: inv.subtotalOre,
    vatOre: inv.vatOre,
    totalOre: inv.totalOre,
    vatRateBp: inv.vatRateBp,
    lines: inv.lines.map((l) => [l.description, l.quantity, l.unit, l.unitPriceOre, l.lineTotalOre, l.accountId]),
    attachments: inv.attachments.map((a) => [a.id, a.name, a.pages, a.sizeBytes, a.filePath])
  });
}

/**
 * Startup repair for the one remaining crash window: the transaction committed
 * but the process died before the .tmp was renamed. The committed row is the
 * truth, so the file simply gets its final name.
 */
export function repairArchivedPdfs(): number {
  let repaired = 0;
  const rows = db.select({ pdfPath: invoice.pdfPath }).from(invoice).where(sql`${invoice.pdfPath} IS NOT NULL`).all();
  for (const r of rows) {
    const abs = path.join(DATA_DIR, r.pdfPath as string);
    if (!fs.existsSync(abs) && fs.existsSync(abs + '.tmp')) {
      fs.renameSync(abs + '.tmp', abs);
      repaired++;
    }
  }
  return repaired;
}

/**
 * Write the rendered PDF next to its final name and rename it into place only
 * after the transaction committed, so a crash can never leave a {number}.pdf
 * that blocks the series.
 */
function archivePdf(absPath: string, pdf: Buffer, commit: () => void): void {
  const tmp = absPath + '.tmp';
  fs.writeFileSync(tmp, pdf);
  try {
    commit();
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.renameSync(tmp, absPath);
}

export function validateForIssue(inv: InvoiceDetail, settings: Record<string, string>): string[] {
  const problems: string[] = [];
  if (inv.lines.length === 0) problems.push('Fakturaen har ingen linjer');
  if (inv.dueDate < inv.issueDate) problems.push('Forfaldsdato ligger før fakturadatoen');
  const missing = companyDetailsComplete(settings);
  if (missing.length) problems.push(`Udfyld firmaoplysninger under Indstillinger: ${missing.join(', ')}`);
  if (!settings.bank_reg || !settings.bank_account) problems.push('Udfyld bankoplysninger (reg.nr. og kontonr.) under Indstillinger; de trykkes på fakturaen');
  return problems;
}

export function nextInvoiceNumber(): number {
  return Number(getSettings().next_invoice_number);
}

export function invoicePdfAbsolutePath(inv: Invoice): string | null {
  return inv.pdfPath ? path.join(DATA_DIR, inv.pdfPath) : null;
}

/**
 * Issue a draft: assigns the next number and flips status inside ONE
 * transaction, after the PDF (which carries the number) has been rendered
 * under the issue lock. The number series therefore never has a gap.
 */
export function issueInvoice(id: number, expectedNumber?: number): Promise<InvoiceDetail> {
  return withIssueLock(async () => {
    const inv = getInvoice(id);
    assertDraft(inv);
    const settings = getSettings();
    const problems = validateForIssue(inv, settings);
    if (problems.length) throw badRequest(problems.join('. '));

    const number = Number(settings.next_invoice_number);
    if (expectedNumber !== undefined && expectedNumber !== number) {
      throw conflict(`Næste fakturanummer er ${number}, ikke ${expectedNumber}. Genindlæs siden og bekræft igen.`);
    }
    const fingerprint = contentFingerprint(inv);
    const relPath = path.posix.join('files', 'invoices', `${number}.pdf`);
    const absPath = path.join(INVOICE_FILES_DIR, `${number}.pdf`);
    if (fs.existsSync(absPath)) throw conflict(`Filen ${relPath} findes allerede`);

    // What the customer writes on the transfer; defaults to the invoice number, which only exists now.
    const paymentReference = inv.paymentReference || `Faktura ${number}`;
    const rendered = await renderInvoicePdf({ ...inv, invoiceNumber: number, status: 'issued', paymentReference }, settings);
    // The archived document is the invoice followed by its attachments, in one file.
    const pdf = await mergePdfs(rendered, attachmentBuffers(id));

    archivePdf(absPath, pdf, () =>
      db.transaction(() => {
        const fresh = getInvoice(id);
        assertDraft(fresh);
        if (contentFingerprint(fresh) !== fingerprint) {
          throw conflict('Kladden blev ændret, mens den blev udstedt. Prøv igen.');
        }
        if (Number(getSettings().next_invoice_number) !== number) {
          throw conflict('Nummerserien blev ændret undervejs. Prøv igen.');
        }
        db.update(invoice)
          .set({ invoiceNumber: number, status: 'issued', pdfPath: relPath, paymentReference })
          .where(eq(invoice.id, id))
          .run();
        setSettingRaw('next_invoice_number', String(number + 1));
        audit('invoice', id, 'issue', { invoiceNumber: number, pdfPath: relPath, totalOre: inv.totalOre, paymentReference, attachments: inv.attachments.map((a) => a.id) });
      })
    );
    return getInvoice(id);
  });
}

/**
 * "Markér som betalt": set paid_date on an issued invoice. On a credit note the
 * date is the refund date ("Markér som refunderet"); until then a credit note of
 * a paid original is money owed to the customer (see balance()).
 */
export function setPaidDate(id: number, paidDate: string): InvoiceDetail {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || !isValidIsoDate(paidDate)) throw badRequest('Ugyldig dato');
  return db.transaction(() => {
    const inv = getInvoice(id);
    if (inv.status !== 'issued') throw conflict('Kun udstedte dokumenter kan markeres som betalt');
    if (inv.paidDate) throw conflict(inv.isCreditNote ? 'Kreditnotaen er allerede refunderet' : 'Fakturaen er allerede markeret som betalt');
    if (inv.isCreditNote && !inv.originalPaidDate) {
      throw conflict('Kreditnotaen modregner en ubetalt faktura; der er intet at refundere');
    }
    db.update(invoice).set({ paidDate }).where(eq(invoice.id, id)).run();
    audit('invoice', id, inv.isCreditNote ? 'mark_refunded' : 'mark_paid', { paidDate });
    return getInvoice(id);
  });
}

/**
 * "Markér som sendt": the date the document went to the customer. Set once, on
 * issued documents only (trigger invoice_sent_once backs this up).
 */
export function markSent(id: number, sentAt: string): InvoiceDetail {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentAt) || !isValidIsoDate(sentAt)) throw badRequest('Ugyldig dato');
  return db.transaction(() => {
    const inv = getInvoice(id);
    if (inv.status === 'draft') throw conflict('Kladder kan ikke markeres som sendt; udsted fakturaen først');
    if (inv.sentAt) throw conflict(`Dokumentet er allerede markeret som sendt ${inv.sentAt}`);
    db.update(invoice).set({ sentAt }).where(eq(invoice.id, id)).run();
    audit('invoice', id, 'mark_sent', { sentAt });
    return getInvoice(id);
  });
}

/**
 * Draft preview: the document as it would be issued now, marked UDKAST and
 * without a number, attachments included. Rendered on the fly and never stored;
 * the archived PDF is only ever produced by issueInvoice().
 */
export function previewDraftPdf(id: number): Promise<Buffer> {
  return withIssueLock(async () => {
    const inv = getInvoice(id);
    assertDraft(inv);
    const settings = getSettings();
    const rendered = await renderInvoicePdf({ ...inv, paymentReference: inv.paymentReference || 'Faktura <nr.>' }, settings, { draft: true });
    return mergePdfs(rendered, attachmentBuffers(id));
  });
}

/**
 * Credit note: a new invoice with negated quantities, its own number from the
 * same series, issued immediately and referencing the original, whose status
 * becomes 'credited'. Everything happens under the issue lock.
 */
export function creditInvoice(id: number, expectedNumber?: number): Promise<InvoiceDetail> {
  return withIssueLock(async () => {
    const orig = getInvoice(id);
    if (orig.status === 'draft') throw conflict('Kladder krediteres ikke; slet kladden i stedet');
    if (orig.status === 'credited') throw conflict('Fakturaen er allerede krediteret');
    if (orig.isCreditNote) throw conflict('En kreditnota kan ikke krediteres');

    const settings = getSettings();
    const missing = companyDetailsComplete(settings);
    if (missing.length) throw badRequest(`Udfyld firmaoplysninger under Indstillinger: ${missing.join(', ')}`);

    const number = Number(settings.next_invoice_number);
    if (expectedNumber !== undefined && expectedNumber !== number) {
      throw conflict(`Næste nummer er ${number}, ikke ${expectedNumber}. Genindlæs siden og bekræft igen.`);
    }
    const paymentReference = `Kreditnota ${number}`;
    const relPath = path.posix.join('files', 'invoices', `${number}.pdf`);
    const absPath = path.join(INVOICE_FILES_DIR, `${number}.pdf`);
    if (fs.existsSync(absPath)) throw conflict(`Filen ${relPath} findes allerede`);

    const today = todayIso();
    const lines: InvoiceLine[] = orig.lines.map((l) => ({
      ...l,
      quantity: -l.quantity,
      lineTotalOre: -l.lineTotalOre
    }));
    // Exact negation of the original figures, never recomputed: rounding could
    // otherwise leave a one-øre residue in the VAT report.
    const totals = {
      subtotalOre: -orig.subtotalOre,
      vatOre: -orig.vatOre,
      totalOre: -orig.totalOre,
      vatRateBp: orig.vatRateBp
    };
    const creditDetail: InvoiceDetail = {
      ...orig,
      id: 0,
      invoiceNumber: number,
      status: 'issued',
      issueDate: today,
      dueDate: today,
      paidDate: null,
      pdfPath: relPath,
      creditedByInvoiceId: null,
      paymentReference,
      lines,
      ...totals,
      isCreditNote: true,
      creditsInvoiceNumber: orig.invoiceNumber,
      creditsInvoiceId: orig.id,
      originalPaidDate: orig.paidDate,
      creditedByNumber: null,
      sentAt: null,
      attachments: []
    };

    const pdf = await renderInvoicePdf(creditDetail, settings);

    let newId = 0;
    archivePdf(absPath, pdf, () =>
      db.transaction(() => {
        const fresh = db.select().from(invoice).where(eq(invoice.id, id)).get();
        if (!fresh || fresh.status !== 'issued') throw conflict('Fakturaen kan ikke krediteres');
        if (Number(getSettings().next_invoice_number) !== number) {
          throw conflict('Nummerserien blev ændret undervejs. Prøv igen.');
        }
        const row = db
          .insert(invoice)
          .values({
            status: 'draft',
            customerId: orig.customerId,
            issueDate: today,
            dueDate: today,
            subtotalOre: totals.subtotalOre,
            vatOre: totals.vatOre,
            totalOre: totals.totalOre,
            vatRateBp: totals.vatRateBp,
            vatExemptReason: orig.vatExemptReason,
            paymentReference,
            createdAt: new Date().toISOString()
          })
          .returning()
          .get();
        newId = row.id;
        db.insert(invoiceLine)
          .values(
            lines.map((l) => ({
              invoiceId: row.id,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPriceOre: l.unitPriceOre,
              lineTotalOre: l.lineTotalOre,
              accountId: l.accountId
            }))
          )
          .run();
        db.update(invoice)
          .set({ invoiceNumber: number, status: 'issued', pdfPath: relPath })
          .where(eq(invoice.id, row.id))
          .run();
        db.update(invoice)
          .set({ status: 'credited', creditedByInvoiceId: row.id })
          .where(eq(invoice.id, id))
          .run();
        setSettingRaw('next_invoice_number', String(number + 1));
        audit('invoice', row.id, 'issue_credit_note', { invoiceNumber: number, creditsInvoiceId: id, pdfPath: relPath });
        audit('invoice', id, 'credited', { creditedByInvoiceId: row.id, creditNoteNumber: number });
      })
    );
    return getInvoice(newId);
  });
}
