import { ZipArchive } from 'archiver';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { asc } from 'drizzle-orm';
import { db } from '../db';
import { account, auditLog, cashMovement, customer, expense, invoice, invoiceLine } from '../schema';
import { FILES_DIR } from '../env';
import { audit } from '../audit';

const BOM = String.fromCharCode(0xfeff);

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[";\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Integer øre -> "1234,56" (Danish decimal comma, no thousands separator). */
export function oreToCsv(ore: number): string {
  const neg = ore < 0;
  const abs = Math.abs(ore);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

function decimalToCsv(n: number): string {
  return String(n).replace('.', ',');
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  return BOM + lines.join('\r\n') + '\r\n';
}

function accountMap() {
  return new Map(db.select().from(account).all().map((a) => [a.id, a]));
}

export function invoicesCsv(): string {
  const custs = new Map(db.select().from(customer).all().map((c) => [c.id, c]));
  const rows = db.select().from(invoice).orderBy(asc(invoice.id)).all();
  return toCsv(
    [
      'id', 'fakturanr', 'status', 'kunde_id', 'kunde', 'fakturadato', 'forfaldsdato', 'valuta',
      'subtotal_ekskl_moms', 'moms', 'total_inkl_moms', 'momssats_pct', 'momsfritagelse',
      'betalingsreference', 'betalt_dato', 'pdf_fil', 'krediteret_af_id', 'oprettet'
    ],
    rows.map((r) => [
      r.id, r.invoiceNumber, r.status, r.customerId, custs.get(r.customerId)?.name ?? '', r.issueDate, r.dueDate,
      r.currency, oreToCsv(r.subtotalOre), oreToCsv(r.vatOre), oreToCsv(r.totalOre), decimalToCsv(r.vatRateBp / 100),
      r.vatExemptReason, r.paymentReference, r.paidDate, r.pdfPath, r.creditedByInvoiceId, r.createdAt
    ])
  );
}

export function invoiceLinesCsv(): string {
  const numbers = new Map(db.select().from(invoice).all().map((i) => [i.id, i.invoiceNumber]));
  const accounts = accountMap();
  const rows = db.select().from(invoiceLine).orderBy(asc(invoiceLine.id)).all();
  return toCsv(
    ['id', 'faktura_id', 'fakturanr', 'beskrivelse', 'antal', 'enhed', 'enhedspris_ekskl_moms', 'linjetotal', 'konto', 'kontonavn'],
    rows.map((r) => [
      r.id, r.invoiceId, numbers.get(r.invoiceId), r.description, decimalToCsv(r.quantity), r.unit,
      oreToCsv(r.unitPriceOre), oreToCsv(r.lineTotalOre), accounts.get(r.accountId)?.number, accounts.get(r.accountId)?.name
    ])
  );
}

export function expensesCsv(): string {
  const accounts = accountMap();
  const rows = db.select().from(expense).orderBy(asc(expense.voucherNumber)).all();
  return toCsv(
    ['id', 'bilagsnr', 'dato', 'leverandoer', 'beskrivelse', 'konto', 'kontonavn', 'beloeb_ekskl_moms', 'moms', 'beloeb_inkl_moms', 'betalt_dato', 'fil', 'oprettet'],
    rows.map((r) => [
      r.id, r.voucherNumber, r.date, r.supplier, r.description, accounts.get(r.accountId)?.number, accounts.get(r.accountId)?.name,
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
  return toCsv(['id', 'kontonr', 'navn', 'type'], rows.map((r) => [r.id, r.number, r.name, r.type === 'revenue' ? 'salg' : 'omkostning']));
}

export function auditLogCsv(): string {
  const rows = db.select().from(auditLog).orderBy(asc(auditLog.id)).all();
  return toCsv(
    ['id', 'tidspunkt', 'entitet', 'entitet_id', 'handling', 'detaljer'],
    rows.map((r) => [r.id, r.timestamp, r.entity, r.entityId, r.action, r.detailJson])
  );
}

const CSV_FILES: Record<string, () => string> = {
  'invoices.csv': invoicesCsv,
  'invoice_lines.csv': invoiceLinesCsv,
  'expenses.csv': expensesCsv,
  'cash_movements.csv': cashMovementsCsv,
  'accounts.csv': accountsCsv,
  'audit_log.csv': auditLogCsv
};

/** Zip with the six CSVs and every file under /data/files/. Streams to the returned readable. */
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
