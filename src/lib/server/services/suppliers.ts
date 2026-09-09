/**
 * Suppliers (leverandører). A supplier is a name with an id: the expense form offers the existing ones in a list and
 * creates a new one from typed text. Names are unique ignoring case; renaming is the only edit, deleting needs the
 * supplier to be unused (expenses keep pointing at the row that was on the bilag).
 */
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { expense, supplier, type Supplier } from '../schema';
import { audit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';

export const supplierNameSchema = z
  .string()
  .trim()
  .min(1, 'Leverandør er påkrævet')
  .max(200, 'Leverandørnavn må højst være 200 tegn')
  .transform((s) => s.replace(/\s+/g, ' '));

export interface SupplierWithUsage extends Supplier {
  /** Expenses on this supplier. */
  usage: number;
  totalExVatOre: number;
  lastDate: string | null;
}

export function listSuppliers(): SupplierWithUsage[] {
  const rows = db
    .select({
      id: supplier.id,
      name: supplier.name,
      createdAt: supplier.createdAt,
      usage: sql<number>`count(${expense.id})`,
      totalExVatOre: sql<number>`coalesce(sum(${expense.amountExVatOre}), 0)`,
      lastDate: sql<string | null>`max(${expense.date})`
    })
    .from(supplier)
    .leftJoin(expense, eq(expense.supplierId, supplier.id))
    .groupBy(supplier.id)
    .all();
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'da'));
}

export function getSupplier(id: number): Supplier {
  const s = db.select().from(supplier).where(eq(supplier.id, id)).get();
  if (!s) throw notFound('Leverandøren findes ikke');
  return s;
}

export function findSupplierByName(name: string): Supplier | undefined {
  return db.select().from(supplier).where(sql`lower(${supplier.name}) = lower(${name})`).get();
}

function parseName(input: unknown): string {
  const r = z.object({ name: supplierNameSchema }).safeParse(input);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  return r.data.name;
}

/** The expense form's "new supplier" text: an existing name (ignoring case) is reused, otherwise a row is created. */
export function findOrCreateSupplier(name: string): Supplier {
  const clean = supplierNameSchema.parse(name);
  const existing = findSupplierByName(clean);
  if (existing) return existing;
  const row = db.insert(supplier).values({ name: clean, createdAt: new Date().toISOString() }).returning().get();
  audit('supplier', row.id, 'create', { name: clean });
  return row;
}

export function createSupplier(input: unknown): Supplier {
  const name = parseName(input);
  return db.transaction(() => {
    const existing = findSupplierByName(name);
    if (existing) throw conflict(`Leverandøren "${existing.name}" findes allerede`);
    return findOrCreateSupplier(name);
  });
}

export function renameSupplier(id: number, input: unknown): Supplier {
  const name = parseName(input);
  return db.transaction(() => {
    const before = getSupplier(id);
    const other = findSupplierByName(name);
    if (other && other.id !== id) throw conflict(`Leverandøren "${other.name}" findes allerede`);
    if (before.name === name) return before;
    const row = db.update(supplier).set({ name }).where(eq(supplier.id, id)).returning().get();
    audit('supplier', id, 'rename', { from: before.name, to: name });
    return row;
  });
}

export function supplierUsage(id: number): number {
  return db.select({ n: sql<number>`count(*)` }).from(expense).where(eq(expense.supplierId, id)).get()?.n ?? 0;
}

/** Never deleted while an expense references it. */
export function deleteSupplier(id: number): void {
  db.transaction(() => {
    const s = getSupplier(id);
    if (supplierUsage(id) > 0) throw conflict('Leverandøren har bilag og kan ikke slettes');
    db.delete(supplier).where(eq(supplier.id, id)).run();
    audit('supplier', id, 'delete', { name: s.name });
  });
}

/** For selects: id and name only, by name. */
export function supplierOptions(): Pick<Supplier, 'id' | 'name'>[] {
  return db.select({ id: supplier.id, name: supplier.name }).from(supplier).orderBy(asc(supplier.name)).all();
}
