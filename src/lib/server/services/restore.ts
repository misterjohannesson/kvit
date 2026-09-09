/**
 * Restore the whole data set from an export zip (the same CSV names the export writes, plus files/). Two steps:
 * `stageRestore` parses and validates the upload, keeps it under DATA_DIR/restore/ and returns a summary the owner
 * confirms; `applyRestore` then copies the current database and files to DATA_DIR/backups/data.bakNN/, rebuilds
 * every table from the CSVs in one transaction and swaps the files directory. Nothing is applied while any row is
 * wrong, and the guard triggers are put back before the transaction commits.
 *
 * posteringer.csv is derived and ignored; audit_log.csv is restored as-is and a `restore` row is appended.
 */
import AdmZip from 'adm-zip';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, sqlite, REQUIRED_TRIGGERS } from '../db';
import { DATA_DIR, EXPENSE_FILES_DIR, FILES_DIR, INVOICE_FILES_DIR } from '../env';
import { audit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';
import { parseCsv } from '../../csv';
import { isValidIsoDate, lineTotalOre, parseDateInput, parseKrToOre } from '../../format';
import { withIssueLock } from './issue-lock';
import { computeTotals, VAT_RATE_BP } from './invoices';
import { DEFAULT_SETTINGS, SETTING_KEYS } from './settings-defaults';
import { countRows } from '../db';
import { account, auditLog, cashMovement, customer, expense, invoice, invoiceAttachment, invoiceLine, supplier } from '../schema';

export const RESTORE_DIR = path.join(DATA_DIR, 'restore');
/** A staged upload that is not confirmed within this window is removed. */
const STAGE_TTL_MS = 2 * 60 * 60 * 1000;
export const RESTORE_MAX_BYTES = 512 * 1024 * 1024;

// ------------------------------------------------------------------------------------------------ parsed rows

interface AccountRow { id: number; number: number; name: string; type: 'revenue' | 'cost'; group: string; archived: number }
interface CustomerRow { id: number; name: string; address: string; zip: string; city: string; country: string; cvr: string | null; email: string; paymentTermsDays: number | null; createdAt: string }
interface InvoiceRow {
  id: number; invoiceNumber: number | null; status: 'draft' | 'issued' | 'credited'; customerId: number; issueDate: string; dueDate: string; currency: string;
  subtotalOre: number; vatOre: number; totalOre: number; vatRateBp: number; vatExemptReason: string | null; paymentReference: string; paidDate: string | null;
  sentAt: string | null; pdfPath: string | null; creditedByInvoiceId: number | null; createdAt: string;
}
interface LineRow { id: number; invoiceId: number; description: string; quantity: number; unit: string; unitPriceOre: number; lineTotalOre: number; accountId: number }
interface AttachmentRow { id: number; invoiceId: number; position: number; name: string; filePath: string; pages: number; sizeBytes: number; createdAt: string }
interface SupplierRow { id: number; name: string; createdAt: string }
interface ExpenseRow { id: number; voucherNumber: number; date: string; supplierId: number; description: string; accountId: number; amountExVatOre: number; vatOre: number; amountInclOre: number; paidDate: string | null; filePath: string | null; createdAt: string }
interface MovementRow { id: number; date: string; description: string; amountOre: number; kind: 'vat_payment' | 'owner' | 'tax' | 'correction' | 'other'; createdAt: string }
interface AuditRow { id: number; timestamp: string; entity: string; entityId: number; action: string; detailJson: string; actor: 'ui' | 'api' }

export interface RestoreData {
  accounts: AccountRow[];
  customers: CustomerRow[];
  suppliers: SupplierRow[];
  invoices: InvoiceRow[];
  lines: LineRow[];
  attachments: AttachmentRow[];
  expenses: ExpenseRow[];
  movements: MovementRow[];
  audit: AuditRow[];
  settings: Record<string, string>;
  /** Zip entry names under files/ (posix, relative to the data directory). */
  files: string[];
  warnings: string[];
}

export interface RestoreSummary {
  id: string;
  fileName: string;
  sizeBytes: number;
  stagedAt: string;
  companyName: string;
  counts: Record<string, { file: number; current: number }>;
  files: { inZip: number; current: number; missing: string[] };
  invoiceRange: { first: number | null; last: number | null };
  warnings: string[];
  backupDir: string;
}

// ------------------------------------------------------------------------------------------------ cell parsers

class RowErrors {
  messages: string[] = [];
  add(file: string, line: number, msg: string) {
    this.messages.push(`${file}, linje ${line}: ${msg}`);
  }
  addFile(file: string, msg: string) {
    this.messages.push(`${file}: ${msg}`);
  }
  throwIfAny(): void {
    if (!this.messages.length) return;
    const shown = this.messages.slice(0, 30);
    const rest = this.messages.length - shown.length;
    throw badRequest(`Eksporten kan ikke indlæses: ${shown.join(' · ')}${rest > 0 ? ` · og ${rest} til` : ''}`);
  }
}

type Row = { line: number; get(col: string): string };

/** Header-mapped rows of one CSV; every column in `required` must exist. */
function table(zip: AdmZip, file: string, required: string[], errors: RowErrors, optional = false): Row[] | null {
  const entry = zip.getEntry(file);
  if (!entry) {
    if (!optional) errors.addFile(file, 'mangler i zippen');
    return null;
  }
  let parsed;
  try {
    parsed = parseCsv(entry.getData().toString('utf8'));
  } catch (e) {
    errors.addFile(file, (e as Error).message);
    return null;
  }
  if (!parsed.rows.length) return [];
  const header = parsed.rows[0].cells.map((c) => c.trim().toLowerCase());
  const idx = new Map(header.map((h, i) => [h, i]));
  const missing = required.filter((c) => !idx.has(c));
  if (missing.length) {
    errors.addFile(file, `mangler kolonnerne ${missing.join(', ')}`);
    return null;
  }
  return parsed.rows.slice(1).map((r) => ({
    line: r.line,
    get: (col: string) => {
      const i = idx.get(col);
      return i === undefined ? '' : (r.cells[i] ?? '').trim();
    }
  }));
}

const P = {
  int(v: string): number {
    if (!/^-?\d+$/.test(v)) throw new Error(`"${v}" er ikke et helt tal`);
    return Number(v);
  },
  optInt(v: string): number | null {
    return v === '' ? null : P.int(v);
  },
  ore(v: string): number {
    if (/^-?\d+\.\d{1,2}$/.test(v)) v = v.replace('.', ',');
    try {
      return parseKrToOre(v);
    } catch {
      throw new Error(`"${v}" er ikke et beløb (brug fx 1234,56)`);
    }
  },
  decimal(v: string): number {
    const n = v.includes(',') ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v);
    if (!Number.isFinite(n)) throw new Error(`"${v}" er ikke et tal`);
    return n;
  },
  date(v: string): string {
    if (isValidIsoDate(v)) return v;
    try {
      return parseDateInput(v);
    } catch {
      throw new Error(`"${v}" er ikke en dato (brug åååå-mm-dd)`);
    }
  },
  optDate(v: string): string | null {
    return v === '' ? null : P.date(v);
  },
  timestamp(v: string): string {
    if (v === '' || Number.isNaN(Date.parse(v))) throw new Error(`"${v}" er ikke et tidspunkt`);
    return v;
  },
  optText(v: string): string | null {
    return v === '' ? null : v;
  },
  enumOf<T extends string>(v: string, allowed: readonly T[], what: string): T {
    if (!(allowed as readonly string[]).includes(v)) throw new Error(`${what} "${v}" skal være ${allowed.join(', ')}`);
    return v as T;
  }
};

/** Run `fn` for a row, turning a thrown message into a row error. */
function each<T>(rows: Row[], file: string, errors: RowErrors, fn: (r: Row) => T): T[] {
  const out: T[] = [];
  for (const r of rows) {
    try {
      out.push(fn(r));
    } catch (e) {
      errors.add(file, r.line, (e as Error).message);
    }
  }
  return out;
}

function unique<T>(rows: T[], key: (t: T) => unknown, file: string, what: string, errors: RowErrors, line: (t: T) => number): void {
  const seen = new Map<unknown, number>();
  for (const r of rows) {
    const k = key(r);
    if (k === null || k === undefined) continue;
    const first = seen.get(k);
    if (first !== undefined) errors.add(file, line(r), `${what} ${String(k)} findes også på linje ${first}`);
    else seen.set(k, line(r));
  }
}

// ------------------------------------------------------------------------------------------------ parse + validate

/** Parse every CSV in the zip and cross-check them. Throws 400 with every problem found. */
export function parseRestoreZip(zip: AdmZip): RestoreData {
  const errors = new RowErrors();
  const warnings: string[] = [];
  const L = new Map<object, number>();
  const remember = <T extends object>(row: T, line: number): T => (L.set(row, line), row);
  const lineOf = (row: object) => L.get(row) ?? 0;

  // accounts
  const accRows = table(zip, 'accounts.csv', ['id', 'kontonr', 'navn', 'type'], errors) ?? [];
  const accounts = each(accRows, 'accounts.csv', errors, (r): AccountRow => {
    const type = r.get('type').toLowerCase();
    return remember(
      {
        id: P.int(r.get('id')),
        number: P.int(r.get('kontonr')),
        name: r.get('navn') || (() => { throw new Error('navn er tomt'); })(),
        type: P.enumOf(type === 'salg' ? 'revenue' : type === 'omkostning' ? 'cost' : type, ['revenue', 'cost'] as const, 'type'),
        group: r.get('gruppe').slice(0, 60),
        archived: ['ja', 'true', '1'].includes(r.get('arkiveret').toLowerCase()) ? 1 : 0
      },
      r.line
    );
  });
  unique(accounts, (a) => a.id, 'accounts.csv', 'id', errors, lineOf);
  unique(accounts, (a) => a.number, 'accounts.csv', 'kontonr', errors, lineOf);
  if (accounts.length && !accounts.some((a) => a.type === 'revenue' && !a.archived)) errors.addFile('accounts.csv', 'kontoplanen har ingen aktiv salgskonto');
  if (accounts.length && !accounts.some((a) => a.type === 'cost' && !a.archived)) errors.addFile('accounts.csv', 'kontoplanen har ingen aktiv omkostningskonto');
  const accountByNumber = new Map(accounts.map((a) => [a.number, a]));

  // customers
  const custRows = table(zip, 'customers.csv', ['id', 'navn', 'adresse', 'postnr', 'by'], errors);
  if (custRows === null) errors.addFile('customers.csv', 'ældre eksporter har ikke denne fil; eksportér igen fra den nuværende version');
  const customers = each(custRows ?? [], 'customers.csv', errors, (r): CustomerRow =>
    remember(
      {
        id: P.int(r.get('id')),
        name: r.get('navn') || (() => { throw new Error('navn er tomt'); })(),
        address: r.get('adresse'),
        zip: r.get('postnr'),
        city: r.get('by'),
        country: r.get('land') || 'DK',
        cvr: P.optText(r.get('cvr')),
        email: r.get('email'),
        paymentTermsDays: P.optInt(r.get('betalingsfrist_dage')),
        createdAt: r.get('oprettet') || new Date().toISOString()
      },
      r.line
    )
  );
  unique(customers, (c) => c.id, 'customers.csv', 'id', errors, lineOf);
  const customerIds = new Set(customers.map((c) => c.id));

  // suppliers (optional file: an older export names them on the expenses only)
  const supRows = table(zip, 'suppliers.csv', ['id', 'navn'], errors, true);
  const suppliers = each(supRows ?? [], 'suppliers.csv', errors, (r): SupplierRow => {
    const name = r.get('navn').replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('navn er tomt');
    return remember({ id: P.int(r.get('id')), name, createdAt: r.get('oprettet') || new Date().toISOString() }, r.line);
  });
  unique(suppliers, (s) => s.id, 'suppliers.csv', 'id', errors, lineOf);
  unique(suppliers, (s) => s.name.toLowerCase(), 'suppliers.csv', 'navn', errors, lineOf);
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const supplierByName = new Map(suppliers.map((s) => [s.name.toLowerCase(), s]));
  let nextSupplierId = Math.max(0, ...suppliers.map((s) => s.id)) + 1;
  /** leverandoer_id when it points at a known supplier, else the name (created on the fly, as the form would). */
  const supplierFor = (idCell: string, nameCell: string): number => {
    const id = P.optInt(idCell);
    if (id !== null && supplierById.has(id)) return id;
    const name = nameCell.replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('leverandoer er tom');
    const known = supplierByName.get(name.toLowerCase());
    if (known) return known.id;
    const created: SupplierRow = { id: nextSupplierId++, name, createdAt: new Date().toISOString() };
    suppliers.push(created);
    supplierById.set(created.id, created);
    supplierByName.set(name.toLowerCase(), created);
    return created.id;
  };

  // invoices
  const invRows = table(zip, 'invoices.csv', ['id', 'fakturanr', 'status', 'kunde_id', 'fakturadato', 'forfaldsdato', 'subtotal_ekskl_moms', 'moms', 'total_inkl_moms'], errors) ?? [];
  const invoices = each(invRows, 'invoices.csv', errors, (r): InvoiceRow => {
    const status = P.enumOf(r.get('status'), ['draft', 'issued', 'credited'] as const, 'status');
    const invoiceNumber = P.optInt(r.get('fakturanr'));
    if (status !== 'draft' && invoiceNumber === null) throw new Error('en udstedt faktura skal have et fakturanr');
    if (status === 'draft' && invoiceNumber !== null) throw new Error('en kladde kan ikke have et fakturanr');
    const pct = r.get('momssats_pct');
    return remember(
      {
        id: P.int(r.get('id')),
        invoiceNumber,
        status,
        customerId: P.int(r.get('kunde_id')),
        issueDate: P.date(r.get('fakturadato')),
        dueDate: P.date(r.get('forfaldsdato')),
        currency: r.get('valuta') || 'DKK',
        subtotalOre: P.ore(r.get('subtotal_ekskl_moms')),
        vatOre: P.ore(r.get('moms')),
        totalOre: P.ore(r.get('total_inkl_moms')),
        vatRateBp: pct === '' ? VAT_RATE_BP : Math.round(P.decimal(pct) * 100),
        vatExemptReason: P.optText(r.get('momsfritagelse')),
        paymentReference: r.get('betalingsreference'),
        paidDate: P.optDate(r.get('betalt_dato')),
        sentAt: P.optDate(r.get('sendt_dato')),
        pdfPath: P.optText(r.get('pdf_fil')),
        creditedByInvoiceId: P.optInt(r.get('krediteret_af_id')),
        createdAt: r.get('oprettet') || new Date().toISOString()
      },
      r.line
    );
  });
  unique(invoices, (i) => i.id, 'invoices.csv', 'id', errors, lineOf);
  unique(invoices, (i) => i.invoiceNumber, 'invoices.csv', 'fakturanr', errors, lineOf);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  for (const i of invoices) {
    if (!customerIds.has(i.customerId)) errors.add('invoices.csv', lineOf(i), `kunde_id ${i.customerId} findes ikke i customers.csv`);
    if (i.creditedByInvoiceId !== null) {
      const cn = invoiceById.get(i.creditedByInvoiceId);
      if (!cn) errors.add('invoices.csv', lineOf(i), `krediteret_af_id ${i.creditedByInvoiceId} findes ikke`);
      else if (i.status !== 'credited') errors.add('invoices.csv', lineOf(i), 'kun en faktura med status credited kan have krediteret_af_id');
      else if (cn.totalOre > 0) errors.add('invoices.csv', lineOf(i), `kreditnota ${cn.invoiceNumber} skal have negative beløb`);
    }
    if (i.status === 'credited' && i.creditedByInvoiceId === null) errors.add('invoices.csv', lineOf(i), 'status credited kræver krediteret_af_id');
  }

  // lines
  const lineRows = table(zip, 'invoice_lines.csv', ['id', 'faktura_id', 'beskrivelse', 'antal', 'enhed', 'enhedspris_ekskl_moms', 'linjetotal', 'konto'], errors) ?? [];
  const lines = each(lineRows, 'invoice_lines.csv', errors, (r): LineRow => {
    const number = P.int(r.get('konto'));
    const acc = accountByNumber.get(number);
    if (!acc) throw new Error(`konto ${number} findes ikke i accounts.csv`);
    if (acc.type !== 'revenue') throw new Error(`konto ${number} er ikke en salgskonto`);
    const quantity = P.decimal(r.get('antal'));
    const unitPriceOre = P.ore(r.get('enhedspris_ekskl_moms'));
    const total = P.ore(r.get('linjetotal'));
    const expected = lineTotalOre(quantity, unitPriceOre);
    if (total !== expected) throw new Error(`linjetotal ${r.get('linjetotal')} passer ikke til antal × enhedspris (${(expected / 100).toFixed(2).replace('.', ',')})`);
    return remember({ id: P.int(r.get('id')), invoiceId: P.int(r.get('faktura_id')), description: r.get('beskrivelse'), quantity, unit: r.get('enhed'), unitPriceOre, lineTotalOre: total, accountId: acc.id }, r.line);
  });
  unique(lines, (l) => l.id, 'invoice_lines.csv', 'id', errors, lineOf);
  const linesByInvoice = new Map<number, LineRow[]>();
  for (const l of lines) {
    if (!invoiceById.has(l.invoiceId)) errors.add('invoice_lines.csv', lineOf(l), `faktura_id ${l.invoiceId} findes ikke i invoices.csv`);
    linesByInvoice.set(l.invoiceId, [...(linesByInvoice.get(l.invoiceId) ?? []), l]);
  }
  // Totals must agree with the lines the way the app computes them; issued documents are legal records.
  for (const i of invoices) {
    if (i.status === 'draft') continue;
    const t = computeTotals(linesByInvoice.get(i.id) ?? [], i.vatExemptReason !== null);
    if (t.subtotalOre !== i.subtotalOre || t.vatOre !== i.vatOre || t.totalOre !== i.totalOre) {
      errors.add('invoices.csv', lineOf(i), `beløbene på faktura ${i.invoiceNumber} passer ikke til linjerne (beregnet ${fmt(t.subtotalOre)} + moms ${fmt(t.vatOre)} = ${fmt(t.totalOre)})`);
    }
  }

  // attachments (optional file)
  const attRows = table(zip, 'invoice_attachments.csv', ['id', 'faktura_id', 'position', 'navn', 'fil'], errors, true);
  if (attRows === null) warnings.push('invoice_attachments.csv mangler (ældre eksport); vedhæftninger genskabes ikke');
  const attachments = each(attRows ?? [], 'invoice_attachments.csv', errors, (r): AttachmentRow =>
    remember(
      { id: P.int(r.get('id')), invoiceId: P.int(r.get('faktura_id')), position: P.int(r.get('position')), name: r.get('navn'), filePath: r.get('fil'), pages: P.optInt(r.get('sider')) ?? 0, sizeBytes: P.optInt(r.get('stoerrelse_bytes')) ?? 0, createdAt: r.get('oprettet') || new Date().toISOString() },
      r.line
    )
  );
  unique(attachments, (a) => a.id, 'invoice_attachments.csv', 'id', errors, lineOf);
  for (const a of attachments) if (!invoiceById.has(a.invoiceId)) errors.add('invoice_attachments.csv', lineOf(a), `faktura_id ${a.invoiceId} findes ikke`);

  // expenses
  const expRows = table(zip, 'expenses.csv', ['id', 'bilagsnr', 'dato', 'leverandoer', 'beskrivelse', 'konto', 'beloeb_ekskl_moms', 'moms', 'beloeb_inkl_moms'], errors) ?? [];
  const expenses = each(expRows, 'expenses.csv', errors, (r): ExpenseRow => {
    const number = P.int(r.get('konto'));
    const acc = accountByNumber.get(number);
    if (!acc) throw new Error(`konto ${number} findes ikke i accounts.csv`);
    if (acc.type !== 'cost') throw new Error(`konto ${number} er ikke en omkostningskonto`);
    const ex = P.ore(r.get('beloeb_ekskl_moms'));
    const vat = P.ore(r.get('moms'));
    const incl = P.ore(r.get('beloeb_inkl_moms'));
    if (incl !== ex + vat) throw new Error(`beloeb_inkl_moms skal være ekskl. + moms (${fmt(ex + vat)})`);
    return remember(
      { id: P.int(r.get('id')), voucherNumber: P.int(r.get('bilagsnr')), date: P.date(r.get('dato')), supplierId: supplierFor(r.get('leverandoer_id'), r.get('leverandoer')), description: r.get('beskrivelse'), accountId: acc.id, amountExVatOre: ex, vatOre: vat, amountInclOre: incl, paidDate: P.optDate(r.get('betalt_dato')), filePath: P.optText(r.get('fil')), createdAt: r.get('oprettet') || new Date().toISOString() },
      r.line
    );
  });
  unique(expenses, (e) => e.id, 'expenses.csv', 'id', errors, lineOf);
  unique(expenses, (e) => e.voucherNumber, 'expenses.csv', 'bilagsnr', errors, lineOf);

  // movements
  const mvRows = table(zip, 'cash_movements.csv', ['id', 'dato', 'beskrivelse', 'beloeb', 'type'], errors) ?? [];
  const movements = each(mvRows, 'cash_movements.csv', errors, (r): MovementRow =>
    remember(
      { id: P.int(r.get('id')), date: P.date(r.get('dato')), description: r.get('beskrivelse'), amountOre: P.ore(r.get('beloeb')), kind: P.enumOf(r.get('type'), ['vat_payment', 'owner', 'tax', 'correction', 'other'] as const, 'type'), createdAt: r.get('oprettet') || new Date().toISOString() },
      r.line
    )
  );
  unique(movements, (m) => m.id, 'cash_movements.csv', 'id', errors, lineOf);

  // audit log
  const auditRows = table(zip, 'audit_log.csv', ['id', 'tidspunkt', 'entitet', 'entitet_id', 'handling', 'detaljer'], errors) ?? [];
  const auditParsed = each(auditRows, 'audit_log.csv', errors, (r): AuditRow => {
    const detail = r.get('detaljer') || '{}';
    try {
      JSON.parse(detail);
    } catch {
      throw new Error('detaljer er ikke gyldig JSON');
    }
    const actor = r.get('aktoer') || 'ui';
    return remember({ id: P.int(r.get('id')), timestamp: P.timestamp(r.get('tidspunkt')), entity: r.get('entitet'), entityId: P.int(r.get('entitet_id')), action: r.get('handling'), detailJson: detail, actor: P.enumOf(actor, ['ui', 'api'] as const, 'aktoer') }, r.line);
  });
  unique(auditParsed, (a) => a.id, 'audit_log.csv', 'id', errors, lineOf);

  // settings (optional file: an older export keeps the current settings)
  const settings: Record<string, string> = {};
  const setRows = table(zip, 'settings.csv', ['noegle', 'vaerdi'], errors, true);
  if (setRows === null) warnings.push('settings.csv mangler (ældre eksport); firmaoplysninger, nummerserie og åbningssaldo beholdes som nu');
  for (const r of setRows ?? []) {
    const key = r.get('noegle');
    if (!SETTING_KEYS.includes(key)) {
      warnings.push(`settings.csv linje ${r.line}: ukendt nøgle "${key}" springes over`);
      continue;
    }
    settings[key] = r.get('vaerdi');
  }
  const maxNumber = Math.max(0, ...invoices.map((i) => i.invoiceNumber ?? 0));
  if (settings.next_invoice_number !== undefined) {
    if (!/^\d+$/.test(settings.next_invoice_number)) errors.addFile('settings.csv', 'next_invoice_number skal være et helt tal');
    else if (Number(settings.next_invoice_number) <= maxNumber) errors.addFile('settings.csv', `next_invoice_number (${settings.next_invoice_number}) skal være større end det højeste fakturanr (${maxNumber})`);
  }
  if (settings.opening_balance_ore !== undefined && !/^-?\d+$/.test(settings.opening_balance_ore)) errors.addFile('settings.csv', 'opening_balance_ore skal være hele øre');
  if (settings.opening_balance_date !== undefined && !isValidIsoDate(settings.opening_balance_date)) errors.addFile('settings.csv', 'opening_balance_date skal være åååå-mm-dd');

  // files
  const files: string[] = [];
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const name = e.entryName.replace(/\\/g, '/');
    if (!name.startsWith('files/')) continue;
    if (name.split('/').some((seg) => seg === '..' || seg === '')) {
      errors.addFile('files/', `ugyldig sti i zippen: ${name}`);
      continue;
    }
    files.push(name);
  }
  const fileSet = new Set(files);
  const referenced = [
    ...invoices.map((i) => i.pdfPath).filter((p): p is string => !!p),
    ...expenses.map((e) => e.filePath).filter((p): p is string => !!p),
    ...attachments.map((a) => a.filePath)
  ];
  const missing = referenced.filter((p) => !fileSet.has(p.replace(/\\/g, '/')));
  for (const m of missing.slice(0, 20)) warnings.push(`filen ${m} nævnes i en CSV men ligger ikke i zippen`);
  if (missing.length > 20) warnings.push(`og ${missing.length - 20} filer til mangler`);

  errors.throwIfAny();
  return { accounts, customers, suppliers, invoices, lines, attachments, expenses, movements, audit: auditParsed, settings, files, warnings };
}

function fmt(ore: number): string {
  return (ore / 100).toFixed(2).replace('.', ',');
}

// ------------------------------------------------------------------------------------------------ staging

function currentCounts(): Record<string, number> {
  return {
    accounts: countRows(account),
    customers: countRows(customer),
    suppliers: countRows(supplier),
    invoices: countRows(invoice),
    lines: countRows(invoiceLine),
    attachments: countRows(invoiceAttachment),
    expenses: countRows(expense),
    movements: countRows(cashMovement),
    audit: countRows(auditLog)
  };
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? countFiles(path.join(dir, d.name)) : 1), 0);
}

/** The directory the next restore will copy the current data into: backups/data.bak01, 02, ... */
export function nextBackupDir(): string {
  const base = path.join(DATA_DIR, 'backups');
  for (let n = 1; n < 1000; n++) {
    const dir = path.join(base, `data.bak${String(n).padStart(2, '0')}`);
    if (!fs.existsSync(dir)) return dir;
  }
  throw conflict('Der er allerede 999 sikkerhedskopier under backups/; ryd op først');
}

function summarize(id: string, fileName: string, sizeBytes: number, data: RestoreData): RestoreSummary {
  const cur = currentCounts();
  const numbers = data.invoices.map((i) => i.invoiceNumber).filter((n): n is number => n !== null);
  const fileSet = new Set(data.files);
  const referenced = [...data.invoices.map((i) => i.pdfPath), ...data.expenses.map((e) => e.filePath), ...data.attachments.map((a) => a.filePath)].filter((p): p is string => !!p);
  return {
    id,
    fileName,
    sizeBytes,
    stagedAt: new Date().toISOString(),
    companyName: data.settings.company_name ?? '',
    counts: {
      accounts: { file: data.accounts.length, current: cur.accounts },
      customers: { file: data.customers.length, current: cur.customers },
      suppliers: { file: data.suppliers.length, current: cur.suppliers },
      invoices: { file: data.invoices.length, current: cur.invoices },
      lines: { file: data.lines.length, current: cur.lines },
      attachments: { file: data.attachments.length, current: cur.attachments },
      expenses: { file: data.expenses.length, current: cur.expenses },
      movements: { file: data.movements.length, current: cur.movements },
      audit: { file: data.audit.length, current: cur.audit }
    },
    files: { inZip: data.files.length, current: countFiles(FILES_DIR), missing: referenced.filter((p) => !fileSet.has(p)) },
    invoiceRange: { first: numbers.length ? Math.min(...numbers) : null, last: numbers.length ? Math.max(...numbers) : null },
    warnings: data.warnings,
    backupDir: nextBackupDir()
  };
}

function cleanupStaged(): void {
  if (!fs.existsSync(RESTORE_DIR)) return;
  const now = Date.now();
  for (const f of fs.readdirSync(RESTORE_DIR)) {
    const p = path.join(RESTORE_DIR, f);
    try {
      if (now - fs.statSync(p).mtimeMs > STAGE_TTL_MS) fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function openZip(bytes: Buffer): AdmZip {
  try {
    return new AdmZip(bytes);
  } catch {
    throw badRequest('Filen er ikke en zip-fil');
  }
}

/** Step 1: validate the upload, keep it, describe it. */
export function stageRestore(bytes: Buffer, fileName = 'eksport.zip'): RestoreSummary {
  if (bytes.length > RESTORE_MAX_BYTES) throw badRequest('Zippen er større end 512 MB');
  cleanupStaged();
  const zip = openZip(bytes);
  const data = parseRestoreZip(zip);
  fs.mkdirSync(RESTORE_DIR, { recursive: true });
  const id = randomBytes(12).toString('hex');
  const summary = summarize(id, fileName, bytes.length, data);
  fs.writeFileSync(path.join(RESTORE_DIR, `${id}.zip`), bytes);
  fs.writeFileSync(path.join(RESTORE_DIR, `${id}.json`), JSON.stringify(summary));
  audit('data', 0, 'restore_staged', { id, fileName, sizeBytes: bytes.length, counts: summary.counts });
  return summary;
}

function stagedPaths(id: string): { zip: string; json: string } {
  if (!/^[0-9a-f]{24}$/.test(id)) throw notFound('Ukendt upload');
  const zip = path.join(RESTORE_DIR, `${id}.zip`);
  const json = path.join(RESTORE_DIR, `${id}.json`);
  if (!fs.existsSync(zip) || !fs.existsSync(json)) throw notFound('Uploaden findes ikke længere (den slettes efter to timer); upload zippen igen');
  return { zip, json };
}

export function getStaged(id: string): RestoreSummary {
  const p = stagedPaths(id);
  return JSON.parse(fs.readFileSync(p.json, 'utf8')) as RestoreSummary;
}

export function discardStaged(id: string): void {
  const p = stagedPaths(id);
  fs.rmSync(p.zip, { force: true });
  fs.rmSync(p.json, { force: true });
}

// ------------------------------------------------------------------------------------------------ apply

export interface RestoreResult {
  backupDir: string;
  counts: Record<string, number>;
  files: number;
  warnings: string[];
}

const TABLE_ORDER_DELETE = ['invoice_attachment', 'invoice_line', 'invoice', 'expense', 'supplier', 'cash_movement', 'audit_log', 'customer', 'account', 'setting'] as const;
const SEQUENCE_TABLES = ['account', 'customer', 'supplier', 'invoice', 'invoice_line', 'invoice_attachment', 'expense', 'cash_movement', 'audit_log'] as const;

/** Step 2: back up, rebuild every table from the staged zip in one transaction, swap files/. */
export function applyRestore(id: string): Promise<RestoreResult> {
  return withIssueLock(async () => {
    const p = stagedPaths(id);
    const zip = openZip(fs.readFileSync(p.zip));
    const data = parseRestoreZip(zip);

    // 1. Copy the current state away first. VACUUM INTO gives a consistent single-file copy of the live database.
    const backupDir = nextBackupDir();
    fs.mkdirSync(backupDir, { recursive: true });
    sqlite.exec(`VACUUM INTO '${path.join(backupDir, 'app.db').replace(/'/g, "''")}'`);
    if (fs.existsSync(FILES_DIR)) fs.cpSync(FILES_DIR, path.join(backupDir, 'files'), { recursive: true });

    // 2. Unpack files/ next to the current directory; nothing is swapped until the database has committed.
    const newFiles = path.join(DATA_DIR, 'files.restore-new');
    fs.rmSync(newFiles, { recursive: true, force: true });
    fs.mkdirSync(newFiles, { recursive: true });
    for (const name of data.files) {
      const entry = zip.getEntry(name)!;
      const target = path.join(DATA_DIR, name.replace(/^files\//, 'files.restore-new/'));
      if (!path.resolve(target).startsWith(path.resolve(newFiles) + path.sep)) throw badRequest(`Ugyldig sti i zippen: ${name}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
    for (const d of ['invoices', 'expenses']) fs.mkdirSync(path.join(newFiles, d), { recursive: true });

    // 3. Rebuild the database. The guard triggers forbid deleting issued documents, audit rows and movements, which
    //    is exactly what a restore must do, so they are dropped and re-created inside the same transaction.
    const counts = db.transaction(() => {
      const triggers = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all() as { name: string; sql: string }[];
      for (const t of triggers) sqlite.exec(`DROP TRIGGER "${t.name}"`);
      sqlite.exec('UPDATE invoice SET credited_by_invoice_id = NULL');
      for (const t of TABLE_ORDER_DELETE) sqlite.exec(`DELETE FROM "${t}"`);

      const ins = (sql: string) => sqlite.prepare(sql);
      const accIns = ins('INSERT INTO account (id, number, name, type, group_name, archived) VALUES (?, ?, ?, ?, ?, ?)');
      for (const a of data.accounts) accIns.run(a.id, a.number, a.name, a.type, a.group, a.archived);
      const custIns = ins('INSERT INTO customer (id, name, address, zip, city, country, cvr, email, payment_terms_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const c of data.customers) custIns.run(c.id, c.name, c.address, c.zip, c.city, c.country, c.cvr, c.email, c.paymentTermsDays, c.createdAt);
      const invIns = ins(
        'INSERT INTO invoice (id, invoice_number, status, customer_id, issue_date, due_date, currency, subtotal_ore, vat_ore, total_ore, vat_rate_bp, vat_exempt_reason, payment_reference, paid_date, pdf_path, sent_at, credited_by_invoice_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)'
      );
      for (const i of data.invoices) invIns.run(i.id, i.invoiceNumber, i.status, i.customerId, i.issueDate, i.dueDate, i.currency, i.subtotalOre, i.vatOre, i.totalOre, i.vatRateBp, i.vatExemptReason, i.paymentReference, i.paidDate, i.pdfPath, i.sentAt, i.createdAt);
      const credIns = ins('UPDATE invoice SET credited_by_invoice_id = ? WHERE id = ?');
      for (const i of data.invoices) if (i.creditedByInvoiceId !== null) credIns.run(i.creditedByInvoiceId, i.id);
      const lineIns = ins('INSERT INTO invoice_line (id, invoice_id, description, quantity, unit, unit_price_ore, line_total_ore, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const l of data.lines) lineIns.run(l.id, l.invoiceId, l.description, l.quantity, l.unit, l.unitPriceOre, l.lineTotalOre, l.accountId);
      const attIns = ins('INSERT INTO invoice_attachment (id, invoice_id, position, name, file_path, pages, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const a of data.attachments) attIns.run(a.id, a.invoiceId, a.position, a.name, a.filePath, a.pages, a.sizeBytes, a.createdAt);
      const supIns = ins('INSERT INTO supplier (id, name, created_at) VALUES (?, ?, ?)');
      for (const s of data.suppliers) supIns.run(s.id, s.name, s.createdAt);
      const expIns = ins('INSERT INTO expense (id, voucher_number, date, supplier_id, description, account_id, amount_ex_vat_ore, vat_ore, amount_incl_ore, paid_date, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const e of data.expenses) expIns.run(e.id, e.voucherNumber, e.date, e.supplierId, e.description, e.accountId, e.amountExVatOre, e.vatOre, e.amountInclOre, e.paidDate, e.filePath, e.createdAt);
      const mvIns = ins('INSERT INTO cash_movement (id, date, description, amount_ore, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const m of data.movements) mvIns.run(m.id, m.date, m.description, m.amountOre, m.kind, m.createdAt);
      const audIns = ins('INSERT INTO audit_log (id, timestamp, entity, entity_id, action, detail_json, actor) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const a of data.audit) audIns.run(a.id, a.timestamp, a.entity, a.entityId, a.action, a.detailJson, a.actor);
      const setIns = ins('INSERT INTO setting (key, value) VALUES (?, ?)');
      const settings = { ...DEFAULT_SETTINGS, ...(Object.keys(data.settings).length ? data.settings : currentSettingsSnapshot()) };
      for (const [k, v] of Object.entries(settings)) setIns.run(k, v);

      // Autoincrement continues after the highest restored id.
      for (const t of SEQUENCE_TABLES) {
        const max = (sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM "${t}"`).get() as { m: number }).m;
        sqlite.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t);
        sqlite.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(t, max);
      }

      for (const t of triggers) sqlite.exec(t.sql);
      const present = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]).map((t) => t.name));
      const lost = REQUIRED_TRIGGERS.filter((t) => !present.has(t));
      if (lost.length) throw new Error(`Guard triggers missing after restore: ${lost.join(', ')}`);
      const violations = sqlite.pragma('foreign_key_check') as unknown[];
      if (violations.length) throw badRequest(`Referencerne i eksporten hænger ikke sammen: ${JSON.stringify(violations.slice(0, 3))}`);

      const c = currentCounts();
      audit('data', 0, 'restore', { id, backupDir: path.basename(backupDir), counts: c, files: data.files.length, warnings: data.warnings.length });
      return c;
    });

    // 4. Swap the files directory; the old one is already inside the backup.
    const old = path.join(DATA_DIR, 'files.restore-old');
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(FILES_DIR)) fs.renameSync(FILES_DIR, old);
    fs.renameSync(newFiles, FILES_DIR);
    fs.rmSync(old, { recursive: true, force: true });
    fs.mkdirSync(INVOICE_FILES_DIR, { recursive: true });
    fs.mkdirSync(EXPENSE_FILES_DIR, { recursive: true });

    // 5. Keep the zip that was applied next to the copy it replaced.
    fs.renameSync(p.zip, path.join(backupDir, 'import.zip'));
    fs.rmSync(p.json, { force: true });
    console.warn(`Data restored from an export; the previous data was copied to ${backupDir}`);
    return { backupDir, counts, files: data.files.length, warnings: data.warnings };
  });
}

/** Settings as they are now, used when the zip has no settings.csv. Read before the setting table is emptied. */
function currentSettingsSnapshot(): Record<string, string> {
  const rows = sqlite.prepare('SELECT key, value FROM setting').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

