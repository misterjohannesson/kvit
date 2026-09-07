import { ZipArchive } from 'archiver';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { asc } from 'drizzle-orm';
import { db } from '../db';
import { auditLog, customer, expense, invoice, invoiceLine } from '../schema';
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
  const rows = db.select().from(invoiceLine).orderBy(asc(invoiceLine.id)).all();
  return toCsv(
    ['id', 'faktura_id', 'fakturanr', 'beskrivelse', 'antal', 'enhed', 'enhedspris_ekskl_moms', 'linjetotal'],
    rows.map((r) => [
      r.id, r.invoiceId, numbers.get(r.invoiceId), r.description, decimalToCsv(r.quantity), r.unit,
      oreToCsv(r.unitPriceOre), oreToCsv(r.lineTotalOre)
    ])
  );
}

export function expensesCsv(): string {
  const rows = db.select().from(expense).orderBy(asc(expense.voucherNumber)).all();
  return toCsv(
    ['id', 'bilagsnr', 'dato', 'leverandoer', 'beskrivelse', 'kategori', 'beloeb_ekskl_moms', 'moms', 'beloeb_inkl_moms', 'betalt_dato', 'fil', 'oprettet'],
    rows.map((r) => [
      r.id, r.voucherNumber, r.date, r.supplier, r.description, r.category, oreToCsv(r.amountExVatOre),
      oreToCsv(r.vatOre), oreToCsv(r.amountInclOre), r.paidDate, r.filePath, r.createdAt
    ])
  );
}

export function auditLogCsv(): string {
  const rows = db.select().from(auditLog).orderBy(asc(auditLog.id)).all();
  return toCsv(
    ['id', 'tidspunkt', 'entitet', 'entitet_id', 'handling', 'detaljer'],
    rows.map((r) => [r.id, r.timestamp, r.entity, r.entityId, r.action, r.detailJson])
  );
}

/** Zip with the four CSVs and every file under /data/files/. Streams to the returned readable. */
export function exportZipStream(): PassThrough {
  const out = new PassThrough();
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (err: Error) => out.destroy(err));
  zip.pipe(out);

  zip.append(invoicesCsv(), { name: 'invoices.csv' });
  zip.append(invoiceLinesCsv(), { name: 'invoice_lines.csv' });
  zip.append(expensesCsv(), { name: 'expenses.csv' });
  zip.append(auditLogCsv(), { name: 'audit_log.csv' });
  if (fs.existsSync(FILES_DIR)) {
    zip.directory(FILES_DIR, 'files');
  }
  audit('export', 0, 'export', { at: new Date().toISOString() });
  void zip.finalize();
  return out;
}

export function exportFileName(): string {
  return `faktura-eksport-${new Date().toISOString().slice(0, 10)}.zip`;
}

