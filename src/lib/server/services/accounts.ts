import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { account, expense, invoiceLine, type Account } from '../schema';
import { audit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';

export const accountNumberSchema = z.coerce
  .number({ error: 'Kontonummer skal være et tal' })
  .int('Kontonummer skal være et helt tal')
  .min(1000, 'Kontonummer skal være mellem 1000 og 9999')
  .max(9999, 'Kontonummer skal være mellem 1000 og 9999');
const nameSchema = z.string().trim().min(1, 'Navn er påkrævet').max(100, 'Navn må højst være 100 tegn');
const groupSchema = z.string().trim().max(60, 'Gruppe må højst være 60 tegn');
const typeSchema = z.enum(['revenue', 'cost'], { message: 'Type skal være salg eller omkostning' });

/** Form selects send ja/nej, JSON sends booleans, CSV sends ja/nej or true/false; absent stays absent. */
export const archivedSchema = z.preprocess((v) => {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['', 'nej', 'no', '0', 'false', 'off'].includes(s)) return false;
    if (['ja', 'yes', '1', 'true', 'on'].includes(s)) return true;
  }
  return v;
}, z.boolean({ message: 'Arkiveret skal være ja eller nej' }));

const accountSchema = z.object({
  number: accountNumberSchema,
  name: nameSchema,
  type: typeSchema,
  group: groupSchema.default(''),
  archived: z.union([z.undefined(), archivedSchema]).transform((v) => v ?? false)
});

const updateSchema = z.object({
  name: nameSchema.optional(),
  group: groupSchema.optional(),
  archived: z.union([z.undefined(), archivedSchema])
});

export type AccountType = Account['type'];
export type AccountInput = z.infer<typeof accountSchema>;

function issues(r: { error: z.ZodError }): string {
  return r.error.issues.map((i) => i.message).join('; ');
}

/** Whole kontoplan (or one type) by number, archived accounts included: reports and the settings table show everything. */
export function listAccounts(type?: AccountType): Account[] {
  const q = db.select().from(account);
  return (type ? q.where(eq(account.type, type)) : q).orderBy(asc(account.number)).all();
}

/** The accounts a new record may use: not archived. */
export function listActiveAccounts(type?: AccountType): Account[] {
  const conds = [eq(account.archived, false)];
  if (type) conds.push(eq(account.type, type));
  return db.select().from(account).where(and(...conds)).orderBy(asc(account.number)).all();
}

/**
 * Options for an account select: every active account of the type plus the archived ones a record already uses,
 * so editing an old record never silently moves it to another account.
 */
export function selectableAccounts(type: AccountType, inUse: Iterable<number> = []): Account[] {
  const keep = new Set(inUse);
  return listAccounts(type).filter((a) => !a.archived || keep.has(a.id));
}

export function getAccount(id: number): Account {
  const a = db.select().from(account).where(eq(account.id, id)).get();
  if (!a) throw notFound('Konto findes ikke');
  return a;
}

export function getAccountByNumber(number: number): Account | undefined {
  return db.select().from(account).where(eq(account.number, number)).get();
}

/**
 * The account an entity may use: revenue accounts on invoice lines, cost accounts on expenses. Archived accounts are
 * refused unless the record already sits on them (`allowArchived`), so old records stay editable.
 */
export function requireAccountOfType(id: number, type: AccountType, allowArchived: Iterable<number> = []): Account {
  const a = db.select().from(account).where(eq(account.id, id)).get();
  if (!a) throw badRequest('Kontoen findes ikke');
  if (a.type !== type) {
    throw badRequest(type === 'revenue' ? 'Fakturalinjer skal bogføres på en salgskonto' : 'Udgifter skal bogføres på en omkostningskonto');
  }
  if (a.archived && !new Set(allowArchived).has(id)) {
    throw badRequest(`Konto ${a.number} ${a.name} er arkiveret. Vælg en anden konto, eller genaktivér den under Indstillinger`);
  }
  return a;
}

export function parseAccountInput(input: unknown): AccountInput {
  const r = accountSchema.safeParse(input);
  if (!r.success) throw badRequest(issues(r));
  return r.data;
}

export function createAccount(input: unknown): Account {
  const data = parseAccountInput(input);
  return db.transaction(() => {
    if (getAccountByNumber(data.number)) throw conflict(`Kontonummer ${data.number} findes allerede`);
    const row = db.insert(account).values(data).returning().get();
    audit('account', row.id, 'create', data);
    return row;
  });
}

/**
 * Name, group and archived flag can change; number and type stay (trigger account_identity_immutable), so existing
 * rows keep their meaning. Only fields present in `input` change; the audit row lists what moved.
 */
export function updateAccount(id: number, input: unknown): Account {
  const r = updateSchema.safeParse(input);
  if (!r.success) throw badRequest(issues(r));
  const patch = r.data;
  return db.transaction(() => {
    const before = getAccount(id);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ['name', 'group', 'archived'] as const) {
      if (patch[k] !== undefined && patch[k] !== before[k]) changes[k] = { from: before[k], to: patch[k] };
    }
    if (!Object.keys(changes).length) return before;
    if (changes.archived?.to === true) assertNotLastActive(before);
    const row = db.update(account).set(patch).where(eq(account.id, id)).returning().get();
    audit('account', id, Object.keys(changes).length === 1 && changes.name ? 'rename' : 'update', changes);
    return row;
  });
}

/** Rename only, kept for callers that only know the name. */
export function renameAccount(id: number, input: unknown): Account {
  const r = z.object({ name: nameSchema }).safeParse(input);
  if (!r.success) throw badRequest(issues(r));
  return updateAccount(id, { name: r.data.name });
}

/** New invoice lines need a revenue account and new expenses a cost account: the last active one of a type stays active. */
function assertNotLastActive(a: Account): void {
  if (a.archived) return;
  const others = listActiveAccounts(a.type).filter((x) => x.id !== a.id);
  if (!others.length) {
    throw conflict(a.type === 'revenue' ? 'Den sidste aktive salgskonto kan ikke arkiveres' : 'Den sidste aktive omkostningskonto kan ikke arkiveres');
  }
}

export function accountUsage(id: number): number {
  const lines = db.select({ n: sql<number>`count(*)` }).from(invoiceLine).where(eq(invoiceLine.accountId, id)).get()?.n ?? 0;
  const expenses = db.select({ n: sql<number>`count(*)` }).from(expense).where(eq(expense.accountId, id)).get()?.n ?? 0;
  return lines + expenses;
}

/** Usage for every account in one pass (the settings table). */
export function accountUsageMap(): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of db.select({ id: invoiceLine.accountId, n: sql<number>`count(*)` }).from(invoiceLine).groupBy(invoiceLine.accountId).all()) m.set(r.id, r.n);
  for (const r of db.select({ id: expense.accountId, n: sql<number>`count(*)` }).from(expense).groupBy(expense.accountId).all()) m.set(r.id, (m.get(r.id) ?? 0) + r.n);
  return m;
}

/** Never deleted while referenced. */
export function deleteAccount(id: number): void {
  db.transaction(() => {
    const a = getAccount(id);
    if (accountUsage(id) > 0) throw conflict('Kontoen er i brug og kan ikke slettes');
    if (!a.archived) assertNotLastActive(a);
    db.delete(account).where(eq(account.id, id)).run();
    audit('account', id, 'delete', { number: a.number, name: a.name, type: a.type });
  });
}

/** Default for new invoice lines: 1000 Konsulentydelser if it exists and is active, else the lowest-numbered active revenue account. */
export function defaultRevenueAccountId(): number {
  const revenue = listActiveAccounts('revenue');
  const preferred = revenue.find((a) => a.number === 1000) ?? revenue[0];
  if (!preferred) throw badRequest('Kontoplanen har ingen aktive salgskonti');
  return preferred.id;
}

/** Danish labels shared by the UI, the CSV and the MCP output. */
export function accountTypeLabel(type: AccountType): 'salg' | 'omkostning' {
  return type === 'revenue' ? 'salg' : 'omkostning';
}
