import { desc, eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db } from '../db';
import { expense, type Expense } from '../schema';
import { audit } from '../audit';
import { badRequest, notFound } from '../errors';
import { DATA_DIR } from '../env';
import { requireAccountOfType } from './accounts';
import { isValidIsoDate } from '../../format';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato skal være åååå-mm-dd').refine(isValidIsoDate, 'Ugyldig dato');

const expenseSchema = z.object({
  date: isoDate,
  supplier: z.string().trim().min(1, 'Leverandør er påkrævet').max(200),
  description: z.string().trim().min(1, 'Beskrivelse er påkrævet').max(500),
  /** Cost account (kontoplan); the free-text note is `description`. */
  accountId: z.coerce.number({ error: 'Konto skal vælges' }).int('Ugyldig konto').positive('Ugyldig konto'),
  amountExVatOre: z.coerce.number({ error: 'Beløb skal være et tal' }).int('Beløb skal være hele øre').max(1e13).min(-1e13),
  /** Entered manually, never derived: foreign purchases and repræsentation break 25 %. */
  vatOre: z.coerce.number({ error: 'Moms skal være et tal' }).int('Moms skal være hele øre').max(1e13).min(-1e13),
  paidDate: z
    .union([isoDate, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v ? v : null))
});

export interface UploadFile {
  name: string;
  /** Client-declared MIME type: informational only, the bytes decide (see sniffUploadExt). */
  type: string;
  bytes: Buffer;
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

export function listExpenses(filter: { year?: number } = {}): Expense[] {
  const q = db.select().from(expense);
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

export function getExpense(id: number): Expense {
  const e = db.select().from(expense).where(eq(expense.id, id)).get();
  if (!e) throw notFound('Udgift findes ikke');
  return e;
}

export function expenseFileAbsolutePath(e: Expense): string | null {
  return e.filePath ? path.join(DATA_DIR, e.filePath) : null;
}

/** Voucher numbers are assigned on create, sequentially from 1, in the insert transaction. */
export function createExpense(input: unknown, file?: UploadFile | null): Expense {
  const data = parse(input);
  const ext = file ? extFor(file) : null;
  return db.transaction(() => {
    requireAccountOfType(data.accountId, 'cost');
    const max = db.select({ m: sql<number | null>`max(${expense.voucherNumber})` }).from(expense).get();
    const voucherNumber = (max?.m ?? 0) + 1;
    const relPath = ext ? path.posix.join('files', 'expenses', `${voucherNumber}.${ext}`) : null;
    const row = db
      .insert(expense)
      .values({
        voucherNumber,
        date: data.date,
        supplier: data.supplier,
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
    audit('expense', row.id, 'create', { voucherNumber, ...data });
    return row;
  });
}

export function updateExpense(id: number, input: unknown): Expense {
  const data = parse(input);
  return db.transaction(() => {
    getExpense(id);
    requireAccountOfType(data.accountId, 'cost');
    const row = db
      .update(expense)
      .set({ ...data, amountInclOre: data.amountExVatOre + data.vatOre })
      .where(eq(expense.id, id))
      .returning()
      .get();
    audit('expense', id, 'update', data);
    return row;
  });
}

/** Attach or replace the voucher file: /data/files/expenses/{voucher_number}.{ext} */
export function uploadExpenseFile(id: number, file: UploadFile): Expense {
  const ext = extFor(file);
  return db.transaction(() => {
    const e = getExpense(id);
    const relPath = path.posix.join('files', 'expenses', `${e.voucherNumber}.${ext}`);
    const abs = path.join(DATA_DIR, relPath);
    const old = expenseFileAbsolutePath(e);
    // Write the new file first; only remove the old one (different extension) once the new one exists.
    fs.writeFileSync(abs, file.bytes);
    const row = db.update(expense).set({ filePath: relPath }).where(eq(expense.id, id)).returning().get();
    audit('expense', id, 'upload', { filePath: relPath, size: file.bytes.length, replaced: e.filePath });
    if (old && old !== abs) fs.rmSync(old, { force: true });
    return row;
  });
}
