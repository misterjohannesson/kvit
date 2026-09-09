import { desc, eq, getTableColumns, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db } from '../db';
import { expense, supplier, type Expense } from '../schema';
import { audit } from '../audit';
import { badRequest, notFound } from '../errors';
import { DATA_DIR } from '../env';
import { requireAccountOfType } from './accounts';
import { findOrCreateSupplier, getSupplier, supplierNameSchema } from './suppliers';
import { isoDate, oreAmount } from '../zod-shared';

const expenseSchema = z
  .object({
    date: isoDate,
    /** An existing supplier by id, or a name: an unknown name creates the supplier. */
    supplierId: z.coerce.number({ error: 'Ugyldig leverandør' }).int('Ugyldig leverandør').positive('Ugyldig leverandør').optional(),
    supplier: supplierNameSchema.optional(),
    description: z.string().trim().min(1, 'Beskrivelse er påkrævet').max(500),
    /** Cost account (kontoplan); the free-text note is `description`. */
    accountId: z.coerce.number({ error: 'Konto skal vælges' }).int('Ugyldig konto').positive('Ugyldig konto'),
    amountExVatOre: oreAmount('Beløb'),
    /** Entered manually, never derived: foreign purchases and repræsentation break 25 %. */
    vatOre: oreAmount('Moms'),
    paidDate: z
      .union([isoDate, z.literal(''), z.null()])
      .optional()
      .transform((v) => (v ? v : null))
  })
  .refine((d) => d.supplierId !== undefined || d.supplier !== undefined, { message: 'Leverandør er påkrævet', path: ['supplier'] });

export interface UploadFile {
  name: string;
  /** Client-declared MIME type: informational only, the bytes decide (see sniffUploadExt). */
  type: string;
  bytes: Buffer;
}

/** An expense as the app hands it out: the row plus the supplier's name. */
export interface ExpenseRow extends Expense {
  supplier: string;
}

function parse(input: unknown) {
  const r = expenseSchema.safeParse(input);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

/** File type from the bytes themselves; the declared MIME type and file name are not trusted. */
export function sniffUploadExt(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

function extFor(file: UploadFile): string {
  const ext = sniffUploadExt(file.bytes);
  if (!ext) throw badRequest('Kun PDF, JPG og PNG kan uploades');
  return ext;
}

const withSupplier = () =>
  db
    .select({ ...getTableColumns(expense), supplier: supplier.name })
    .from(expense)
    .innerJoin(supplier, eq(supplier.id, expense.supplierId));

export function listExpenses(filter: { year?: number } = {}): ExpenseRow[] {
  const q = withSupplier();
  if (filter.year) {
    return q
      .where(sql`substr(${expense.date}, 1, 4) = ${String(filter.year)}`)
      .orderBy(desc(expense.date), desc(expense.voucherNumber))
      .all();
  }
  return q.orderBy(desc(expense.date), desc(expense.voucherNumber)).all();
}

export function listExpenseYears(): number[] {
  return db
    .select({ y: sql<string>`substr(${expense.date}, 1, 4)` })
    .from(expense)
    .groupBy(sql`substr(${expense.date}, 1, 4)`)
    .orderBy(desc(sql`substr(${expense.date}, 1, 4)`))
    .all()
    .map((r) => Number(r.y));
}

export function getExpense(id: number): ExpenseRow {
  const e = withSupplier().where(eq(expense.id, id)).get();
  if (!e) throw notFound('Udgift findes ikke');
  return e;
}

export function expenseFileAbsolutePath(e: Expense): string | null {
  return e.filePath ? path.join(DATA_DIR, e.filePath) : null;
}

/** The supplier row for the input: by id (must exist) or by name (created if new). */
function resolveSupplier(data: { supplierId?: number; supplier?: string }) {
  if (data.supplierId !== undefined) {
    try {
      return getSupplier(data.supplierId);
    } catch {
      throw badRequest('Leverandøren findes ikke');
    }
  }
  return findOrCreateSupplier(data.supplier as string);
}

/** Voucher numbers are assigned on create, sequentially from 1, in the insert transaction. */
export function createExpense(input: unknown, file?: UploadFile | null): ExpenseRow {
  const data = parse(input);
  const ext = file ? extFor(file) : null;
  return db.transaction(() => {
    requireAccountOfType(data.accountId, 'cost');
    const sup = resolveSupplier(data);
    const max = db.select({ m: sql<number | null>`max(${expense.voucherNumber})` }).from(expense).get();
    const voucherNumber = (max?.m ?? 0) + 1;
    const relPath = ext ? path.posix.join('files', 'expenses', `${voucherNumber}.${ext}`) : null;
    const row = db
      .insert(expense)
      .values({
        voucherNumber,
        date: data.date,
        supplierId: sup.id,
        description: data.description,
        accountId: data.accountId,
        amountExVatOre: data.amountExVatOre,
        vatOre: data.vatOre,
        amountInclOre: data.amountExVatOre + data.vatOre,
        paidDate: data.paidDate,
        filePath: relPath,
        createdAt: new Date().toISOString()
      })
      .returning()
      .get();
    if (file && relPath) {
      fs.writeFileSync(path.join(DATA_DIR, relPath), file.bytes);
      audit('expense', row.id, 'upload', { filePath: relPath, size: file.bytes.length });
    }
    audit('expense', row.id, 'create', { voucherNumber, ...data, supplierId: sup.id, supplier: sup.name });
    return { ...row, supplier: sup.name };
  });
}

export function updateExpense(id: number, input: unknown): ExpenseRow {
  const data = parse(input);
  return db.transaction(() => {
    const before = getExpense(id);
    // The expense may stay on an account archived after it was booked; a new choice must be active.
    requireAccountOfType(data.accountId, 'cost', [before.accountId]);
    const sup = resolveSupplier(data);
    const row = db
      .update(expense)
      .set({
        date: data.date,
        supplierId: sup.id,
        description: data.description,
        accountId: data.accountId,
        amountExVatOre: data.amountExVatOre,
        vatOre: data.vatOre,
        amountInclOre: data.amountExVatOre + data.vatOre,
        paidDate: data.paidDate
      })
      .where(eq(expense.id, id))
      .returning()
      .get();
    audit('expense', id, 'update', { ...data, supplierId: sup.id, supplier: sup.name });
    return { ...row, supplier: sup.name };
  });
}

/** Attach or replace the voucher file: /data/files/expenses/{voucher_number}.{ext} */
export function uploadExpenseFile(id: number, file: UploadFile): ExpenseRow {
  const ext = extFor(file);
  return db.transaction(() => {
    const e = getExpense(id);
    const relPath = path.posix.join('files', 'expenses', `${e.voucherNumber}.${ext}`);
    const abs = path.join(DATA_DIR, relPath);
    const old = expenseFileAbsolutePath(e);
    // Write the new file first; only remove the old one (different extension) once the new one exists.
    fs.writeFileSync(abs, file.bytes);
    db.update(expense).set({ filePath: relPath }).where(eq(expense.id, id)).run();
    audit('expense', id, 'upload', { filePath: relPath, size: file.bytes.length, replaced: e.filePath });
    if (old && old !== abs) fs.rmSync(old, { force: true });
    return { ...e, filePath: relPath };
  });
}
