import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { account, expense, invoiceLine, type Account } from '../schema';
import { audit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';

const accountSchema = z.object({
  number: z.coerce.number({ error: 'Kontonummer skal være et tal' }).int('Kontonummer skal være et helt tal').min(1000, 'Kontonummer skal være mellem 1000 og 9999').max(9999, 'Kontonummer skal være mellem 1000 og 9999'),
  name: z.string().trim().min(1, 'Navn er påkrævet').max(100),
  type: z.enum(['revenue', 'cost'], { message: 'Type skal være salg eller omkostning' })
});

export type AccountType = Account['type'];

export function listAccounts(type?: AccountType): Account[] {
  const q = db.select().from(account);
  return (type ? q.where(eq(account.type, type)) : q).orderBy(asc(account.number)).all();
}

export function getAccount(id: number): Account {
  const a = db.select().from(account).where(eq(account.id, id)).get();
  if (!a) throw notFound('Konto findes ikke');
  return a;
}

/** The account an entity may use: revenue accounts on invoice lines, cost accounts on expenses. */
export function requireAccountOfType(id: number, type: AccountType): Account {
  const a = db.select().from(account).where(eq(account.id, id)).get();
  if (!a) throw badRequest('Kontoen findes ikke');
  if (a.type !== type) {
    throw badRequest(type === 'revenue' ? 'Fakturalinjer skal bogføres på en salgskonto' : 'Udgifter skal bogføres på en omkostningskonto');
  }
  return a;
}

export function createAccount(input: unknown): Account {
  const r = accountSchema.safeParse(input);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  const data = r.data;
  return db.transaction(() => {
    if (db.select().from(account).where(eq(account.number, data.number)).get()) {
      throw conflict(`Kontonummer ${data.number} findes allerede`);
    }
    const row = db.insert(account).values(data).returning().get();
    audit('account', row.id, 'create', data);
    return row;
  });
}

/** Rename only: number and type stay, so existing rows keep their meaning. */
export function renameAccount(id: number, input: unknown): Account {
  const r = z.object({ name: z.string().trim().min(1, 'Navn er påkrævet').max(100) }).safeParse(input);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  return db.transaction(() => {
    const before = getAccount(id);
    const row = db.update(account).set({ name: r.data.name }).where(eq(account.id, id)).returning().get();
    audit('account', id, 'rename', { from: before.name, to: r.data.name });
    return row;
  });
}

export function accountUsage(id: number): number {
  const lines = db.select({ n: sql<number>`count(*)` }).from(invoiceLine).where(eq(invoiceLine.accountId, id)).get()?.n ?? 0;
  const expenses = db.select({ n: sql<number>`count(*)` }).from(expense).where(eq(expense.accountId, id)).get()?.n ?? 0;
  return lines + expenses;
}

/** Never deleted while referenced. */
export function deleteAccount(id: number): void {
  db.transaction(() => {
    getAccount(id);
    if (accountUsage(id) > 0) throw conflict('Kontoen er i brug og kan ikke slettes');
    db.delete(account).where(eq(account.id, id)).run();
    audit('account', id, 'delete', {});
  });
}

/** Default for new invoice lines: 1000 Konsulentydelser if it exists, else the lowest-numbered revenue account. */
export function defaultRevenueAccountId(): number {
  const revenue = listAccounts('revenue');
  const preferred = revenue.find((a) => a.number === 1000) ?? revenue[0];
  if (!preferred) throw badRequest('Kontoplanen har ingen salgskonti');
  return preferred.id;
}

