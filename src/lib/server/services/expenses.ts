import { asc, desc, eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db } from '../db';
import { expense, type Expense } from '../schema';
import { audit } from '../audit';
import { badRequest, notFound } from '../errors';
import { DATA_DIR, EXPENSE_FILES_DIR } from '../env';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato skal være åååå-mm-dd');

const expenseSchema = z.object({
  date: isoDate,
  supplier: z.string().trim().min(1, 'Leverandør er påkrævet').max(200),
  description: z.string().trim().min(1, 'Beskrivelse er påkrævet').max(500),
  category: z.string().trim().min(1, 'Kategori er påkrævet').max(100),
  amountExVatOre: z.coerce.number().int('Beløb skal være hele øre'),
  /** Entered manually, never derived: foreign purchases and repræsentation break 25 %. */
  vatOre: z.coerce.number().int('Moms skal være hele øre'),
  paidDate: z
    .union([isoDate, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v ? v : null))
});

export type ExpenseInput = z.input<typeof expenseSchema>;

export const ALLOWED_UPLOAD_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

export interface UploadFile {
  name: string;
  type: string;
  bytes: Buffer;
}

function parse(input: unknown) {
  const r = expenseSchema.safeParse(input);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

function extFor(file: UploadFile): string {
  const byType = ALLOWED_UPLOAD_EXT[file.type];
  const byName = path.extname(file.name).toLowerCase().replace('.', '').replace('jpeg', 'jpg');
  const ext = byType ?? (['pdf', 'jpg', 'png'].includes(byName) ? byName : null);
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

export function listCategories(): string[] {
  return db
    .select({ c: expense.category })
    .from(expense)
    .groupBy(expense.category)
    .orderBy(asc(expense.category))
    .all()
    .map((r) => r.c);
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
        category: data.category,
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
    const old = expenseFileAbsolutePath(e);
    if (old && old !== path.join(DATA_DIR, relPath)) fs.rmSync(old, { force: true });
    fs.mkdirSync(EXPENSE_FILES_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, relPath), file.bytes);
    const row = db.update(expense).set({ filePath: relPath }).where(eq(expense.id, id)).returning().get();
    audit('expense', id, 'upload', { filePath: relPath, size: file.bytes.length, replaced: e.filePath });
    return row;
  });
}
