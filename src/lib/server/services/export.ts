import { ZipArchive } from 'archiver';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { asc } from 'drizzle-orm';
import { db } from '../db';
import { account, auditLog, cashMovement, customer, expense, invoice, invoiceAttachment, invoiceLine, setting, supplier, timeEntry, timeGroup } from '../schema';
import { FILES_DIR } from '../env';
import { audit } from '../audit';
import { decimalToCsv, oreToCsv, toCsv } from '../../csv';
import { SETTING_KEYS } from './settings-defaults';
import { journalCsv } from './journal';

export { oreToCsv, toCsv };

function accountMap() {
  return new Map(db.select().from(account).all().map((a) => [a.id, a]));
}

export function invoicesCsv(): string {
  const custs = new Map(db.select().from(customer).all().map((c) => [c.id, c]));
  const rows = db.select().from(invoice).orderBy(asc(invoice.id)).all();
  const attachmentCounts = new Map<number, number>();
  for (const a of db.select({ invoiceId: invoiceAttachment.invoiceId }).from(invoiceAttachment).all()) attachmentCounts.set(a.invoiceId, (attachmentCounts.get(a.invoiceId) ?? 0) + 1);
  return toCsv(
    [
      'id', 'fakturanr', 'status', 'kunde_id', 'kunde', 'fakturadato', 'forfaldsdato', 'valuta',
      'subtotal_ekskl_moms', 'moms', 'total_inkl_moms', 'momssats_pct', 'momsfritagelse',
      'betalingsreference', 'betalt_dato', 'sendt_dato', 'bilag_antal', 'pdf_fil', 'krediteret_af_id', 'oprettet'
    ],
    rows.map((r) => [
      r.id, r.invoiceNumber, r.status, r.customerId, custs.get(r.customerId)?.name ?? '', r.issueDate, r.dueDate,
      r.currency, oreToCsv(r.subtotalOre), oreToCsv(r.vatOre), oreToCsv(r.totalOre), decimalToCsv(r.vatRateBp / 100),
      r.vatExemptReason, r.paymentReference, r.paidDate, r.sentAt, attachmentCounts.get(r.id) ?? 0, r.pdfPath, r.creditedByInvoiceId, r.createdAt
    ])
  );
}

export function invoiceLinesCsv(): string {
  const numbers = new Map(db.select().from(invoice).all().map((i) => [i.id, i.invoiceNumber]));
  const accounts = accountMap();
  const rows = db.select().from(invoiceLine).orderBy(asc(invoiceLine.id)).all();
  return toCsv(
    ['id', 'faktura_id', 'fakturanr', 'beskrivelse', 'antal', 'enhed', 'enhedspris_ekskl_moms', 'linjetotal', 'konto', 'kontonavn', 'type'],
    rows.map((r) => [
      r.id, r.invoiceId, numbers.get(r.invoiceId), r.description, decimalToCsv(r.quantity), r.unit,
      oreToCsv(r.unitPriceOre), oreToCsv(r.lineTotalOre), accounts.get(r.accountId)?.number, accounts.get(r.accountId)?.name, r.kind
    ])
  );
}

export function invoiceAttachmentsCsv(): string {
  const rows = db.select().from(invoiceAttachment).orderBy(asc(invoiceAttachment.id)).all();
  return toCsv(
    ['id', 'faktura_id', 'position', 'navn', 'fil', 'sider', 'stoerrelse_bytes', 'oprettet'],
    rows.map((r) => [r.id, r.invoiceId, r.position, r.name, r.filePath, r.pages, r.sizeBytes, r.createdAt])
  );
}

export function customersCsv(): string {
  const rows = db.select().from(customer).orderBy(asc(customer.id)).all();
  return toCsv(
    ['id', 'navn', 'adresse', 'postnr', 'by', 'land', 'cvr', 'email', 'betalingsfrist_dage', 'timepris', 'oprettet'],
    rows.map((r) => [r.id, r.name, r.address, r.zip, r.city, r.country, r.cvr, r.email, r.paymentTermsDays, r.hourlyRateOre === null ? null : oreToCsv(r.hourlyRateOre), r.createdAt])
  );
}

/** Logged time with its invoiced part; minutter is the logged truth, timer is the same in hours for reading. */
export function timeEntriesCsv(): string {
  const numbers = new Map(db.select().from(invoice).all().map((i) => [i.id, i.invoiceNumber]));
  const custs = new Map(db.select().from(customer).all().map((c) => [c.id, c.name]));
  const rows = db.select().from(timeEntry).orderBy(asc(timeEntry.id)).all();
  return toCsv(
    ['id', 'kunde_id', 'kunde', 'dato', 'minutter', 'timer', 'beskrivelse', 'fakturerbar', 'faktura_id', 'fakturanr', 'overskrift_id', 'position', 'fakt_timer', 'fakt_beskrivelse', 'timepris', 'standard_timepris', 'oprettet'],
    rows.map((r) => [
      r.id, r.customerId, custs.get(r.customerId) ?? '', r.date, r.minutes, decimalToCsv(Math.round((r.minutes / 60) * 100) / 100), r.description, r.billable ? 'ja' : 'nej',
      r.invoiceId, r.invoiceId === null ? null : numbers.get(r.invoiceId), r.groupId, r.position, r.invoicedHours === null ? null : decimalToCsv(r.invoicedHours), r.invoicedDescription,
      r.rateOre === null ? null : oreToCsv(r.rateOre), r.standardRateOre === null ? null : oreToCsv(r.standardRateOre), r.createdAt
    ])
  );
}

/** Headings on invoices that time entries are grouped under. */
export function timeGroupsCsv(): string {
  const rows = db.select().from(timeGroup).orderBy(asc(timeGroup.id)).all();
  return toCsv(['id', 'faktura_id', 'position', 'beskrivelse', 'oprettet'], rows.map((r) => [r.id, r.invoiceId, r.position, r.description, r.createdAt]));
}

export function suppliersCsv(): string {
  const rows = db.select().from(supplier).orderBy(asc(supplier.id)).all();
  return toCsv(['id', 'navn', 'oprettet'], rows.map((r) => [r.id, r.name, r.createdAt]));
}

export function expensesCsv(): string {
  const accounts = accountMap();
  const suppliers = new Map(db.select().from(supplier).all().map((s) => [s.id, s.name]));
  const rows = db.select().from(expense).orderBy(asc(expense.voucherNumber)).all();
  return toCsv(
    ['id', 'bilagsnr', 'dato', 'leverandoer_id', 'leverandoer', 'beskrivelse', 'konto', 'kontonavn', 'beloeb_ekskl_moms', 'moms', 'beloeb_inkl_moms', 'betalt_dato', 'fil', 'oprettet'],
    rows.map((r) => [
      r.id, r.voucherNumber, r.date, r.supplierId, suppliers.get(r.supplierId) ?? '', r.description, accounts.get(r.accountId)?.number, accounts.get(r.accountId)?.name,
      oreToCsv(r.amountExVatOre), oreToCsv(r.vatOre), oreToCsv(r.amountInclOre), r.paidDate, r.filePath, r.createdAt
    ])
  );
}

export function cashMovementsCsv(): string {
  const rows = db.select().from(cashMovement).orderBy(asc(cashMovement.date), asc(cashMovement.id)).all();
  return toCsv(
    ['id', 'dato', 'beskrivelse', 'beloeb', 'type', 'oprettet'],
    rows.map((r) => [r.id, r.date, r.description, oreToCsv(r.amountOre), r.kind, r.createdAt])
  );
}

export function accountsCsv(): string {
  const rows = db.select().from(account).orderBy(asc(account.number)).all();
  return toCsv(
    ['id', 'kontonr', 'navn', 'type', 'gruppe', 'arkiveret'],
    rows.map((r) => [r.id, r.number, r.name, r.type === 'revenue' ? 'salg' : 'omkostning', r.group, r.archived ? 'ja' : 'nej'])
  );
}

export function auditLogCsv(): string {
  const rows = db.select().from(auditLog).orderBy(asc(auditLog.id)).all();
  return toCsv(
    ['id', 'tidspunkt', 'entitet', 'entitet_id', 'handling', 'detaljer', 'aktoer'],
    rows.map((r) => [r.id, r.timestamp, r.entity, r.entityId, r.action, r.detailJson, r.actor])
  );
}

/** Company details, number series, opening balance and balance-account mapping; no secrets live in `setting`. */
export function settingsCsv(): string {
  const rows = db.select().from(setting).orderBy(asc(setting.key)).all().filter((r) => SETTING_KEYS.includes(r.key));
  return toCsv(['noegle', 'vaerdi'], rows.map((r) => [r.key, r.value]));
}

/** The CSVs in the export. Everything except posteringer.csv (derived) is read back by a restore. */
export const CSV_FILES: Record<string, () => string> = {
  'invoices.csv': invoicesCsv,
  'invoice_lines.csv': invoiceLinesCsv,
  'invoice_attachments.csv': invoiceAttachmentsCsv,
  'time_entries.csv': timeEntriesCsv,
  'time_groups.csv': timeGroupsCsv,
  'customers.csv': customersCsv,
  'suppliers.csv': suppliersCsv,
  'expenses.csv': expensesCsv,
  'cash_movements.csv': cashMovementsCsv,
  'accounts.csv': accountsCsv,
  'settings.csv': settingsCsv,
  'audit_log.csv': auditLogCsv,
  'posteringer.csv': journalCsv
};

export const CSV_FILE_NAMES = Object.keys(CSV_FILES);

/** Zip with the thirteen CSVs and every file under /data/files/. Streams to the returned readable. */
export function exportZipStream(): PassThrough {
  const out = new PassThrough();
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (err: Error) => out.destroy(err));
  zip.pipe(out);

  for (const [name, build] of Object.entries(CSV_FILES)) zip.append(build(), { name });
  if (fs.existsSync(FILES_DIR)) {
    zip.directory(FILES_DIR, 'files');
  }
  zip.on('end', () => audit('export', 0, 'export', { at: new Date().toISOString() }));
  void zip.finalize();
  return out;
}

export function exportFileName(): string {
  return `faktura-eksport-${new Date().toISOString().slice(0, 10)}.zip`;
}
