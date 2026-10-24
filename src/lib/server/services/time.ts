/**
 * Tidsregistrering: hours logged per customer, billed by putting them on a draft invoice.
 *
 * An entry is unbilled (no invoice), on a draft, or billed (its invoice is issued or credited). The logged part is
 * locked as soon as the entry is on an invoice; the invoiced part (hours, text, rate) is set and edited on the draft
 * and frozen when the invoice is issued. On the draft, entries can be indented under a heading (time_group), which
 * prints as one line whose hours and total are the sums of its entries. Deleting the draft releases its entries;
 * crediting the invoice does not. The database triggers in migration 0014 back these rules up.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { customer, invoice, timeEntry, timeGroup, type Invoice, type TimeEntry } from '../schema';
import { audit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';
import { isoDate } from '../zod-shared';
import { lineTotalOre, minutesToHours, roundOre } from '../../format';

export type TimeStatus = 'unbilled' | 'draft' | 'billed' | 'not_billable';
export const TIME_STATUS_LABEL: Record<TimeStatus, string> = {
  unbilled: 'Ikke faktureret',
  draft: 'På kladde',
  billed: 'Faktureret',
  not_billable: 'Ikke fakturerbar'
};

export interface TimeEntryRow extends TimeEntry {
  customerName: string;
  status: TimeStatus;
  invoiceNumber: number | null;
  invoiceStatus: Invoice['status'] | null;
  /** Logged minutes as hours, two decimals. */
  hours: number;
}

const hoursSchema = (label: string) =>
  z.coerce
    .number({ error: `${label} skal være et tal` })
    .refine((n) => Number.isFinite(n) && n > 0 && n <= 10000, `${label} skal være mere end 0`)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, `${label} kan højst have to decimaler`);

const descriptionSchema = z.string().trim().min(1, 'Beskrivelse er påkrævet').max(500);
const minutesSchema = z.coerce
  .number({ error: 'Minutter skal være et tal' })
  .int('Minutter skal være hele minutter')
  .min(1, 'Tiden skal være mere end 0')
  .max(24 * 60, 'Højst 24 timer pr. registrering');
const rateSchema = z.coerce.number({ error: 'Timepris skal være et tal' }).int('Timepris skal være hele øre').min(0, 'Timepris kan ikke være negativ').max(1e9, 'Timepris er for stor');

/** Logged fields. Time is given as minutes or as hours (two decimals); hours win if both are sent. */
const entryInputSchema = z
  .object({
    customerId: z.coerce.number({ error: 'Kunde skal vælges' }).int('Ugyldig kunde').positive('Ugyldig kunde'),
    date: isoDate,
    minutes: minutesSchema.optional(),
    hours: hoursSchema('Timer').optional(),
    description: descriptionSchema,
    billable: z.boolean().default(true)
  })
  .transform((v, ctx) => {
    const minutes = v.hours !== undefined ? Math.round(v.hours * 60) : v.minutes;
    if (minutes === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Angiv tiden i timer eller minutter' });
      return z.NEVER;
    }
    if (minutes < 1 || minutes > 24 * 60) {
      ctx.addIssue({ code: 'custom', message: minutes < 1 ? 'Tiden skal være mere end 0' : 'Højst 24 timer pr. registrering' });
      return z.NEVER;
    }
    return { customerId: v.customerId, date: v.date, minutes, description: v.description, billable: v.billable };
  });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

function statusOf(e: TimeEntry, invoiceStatus: Invoice['status'] | null): TimeStatus {
  if (e.invoiceId !== null) return invoiceStatus === 'draft' ? 'draft' : 'billed';
  return e.billable ? 'unbilled' : 'not_billable';
}

function rowsQuery() {
  return db
    .select({ e: timeEntry, customerName: customer.name, invoiceNumber: invoice.invoiceNumber, invoiceStatus: invoice.status })
    .from(timeEntry)
    .innerJoin(customer, eq(customer.id, timeEntry.customerId))
    .leftJoin(invoice, eq(invoice.id, timeEntry.invoiceId));
}

function toRow(r: { e: TimeEntry; customerName: string; invoiceNumber: number | null; invoiceStatus: Invoice['status'] | null }): TimeEntryRow {
  return { ...r.e, customerName: r.customerName, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, status: statusOf(r.e, r.invoiceStatus), hours: minutesToHours(r.e.minutes) };
}

export interface TimeFilter {
  customerId?: number;
  status?: string;
  from?: string;
  to?: string;
}

export function listTimeEntries(filter: TimeFilter = {}): TimeEntryRow[] {
  const conds = [];
  if (filter.customerId) conds.push(eq(timeEntry.customerId, filter.customerId));
  if (filter.from) conds.push(gte(timeEntry.date, filter.from));
  if (filter.to) conds.push(lte(timeEntry.date, filter.to));
  if (filter.status === 'unbilled') conds.push(isNull(timeEntry.invoiceId), eq(timeEntry.billable, true));
  if (filter.status === 'not_billable') conds.push(isNull(timeEntry.invoiceId), eq(timeEntry.billable, false));
  if (filter.status === 'draft') conds.push(isNotNull(timeEntry.invoiceId), eq(invoice.status, 'draft'));
  if (filter.status === 'billed') conds.push(isNotNull(timeEntry.invoiceId), sql`${invoice.status} <> 'draft'`);
  return rowsQuery()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(timeEntry.date), desc(timeEntry.id))
    .all()
    .map(toRow);
}

export function getTimeEntry(id: number): TimeEntryRow {
  const r = rowsQuery().where(eq(timeEntry.id, id)).get();
  if (!r) throw notFound('Tidsregistreringen findes ikke');
  return toRow(r);
}

function requireCustomer(id: number) {
  const c = db.select().from(customer).where(eq(customer.id, id)).get();
  if (!c) throw badRequest('Kunden findes ikke');
  return c;
}

function assertUnbilled(e: TimeEntryRow): void {
  if (e.invoiceId === null) return;
  const where = e.invoiceStatus === 'draft' ? 'en kladde' : `faktura ${e.invoiceNumber}`;
  throw conflict(`Registreringen er på ${where} og er låst. ${e.invoiceStatus === 'draft' ? 'Fjern den fra kladden for at rette den.' : 'Den kan ikke ændres.'}`);
}

export function createTimeEntry(input: unknown): TimeEntryRow {
  const data = parse(entryInputSchema, input);
  requireCustomer(data.customerId);
  return db.transaction(() => {
    const row = db.insert(timeEntry).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
    audit('time_entry', row.id, 'create', data);
    return getTimeEntry(row.id);
  });
}

/** Partial update of the logged fields; unbilled entries only. */
export function updateTimeEntry(id: number, input: unknown): TimeEntryRow {
  const existing = getTimeEntry(id);
  assertUnbilled(existing);
  const patch = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const merged = {
    customerId: patch.customerId ?? existing.customerId,
    date: patch.date ?? existing.date,
    ...(patch.hours !== undefined ? { hours: patch.hours } : { minutes: patch.minutes ?? existing.minutes }),
    description: patch.description ?? existing.description,
    billable: patch.billable ?? existing.billable
  };
  const data = parse(entryInputSchema, merged);
  requireCustomer(data.customerId);
  return db.transaction(() => {
    assertUnbilled(getTimeEntry(id));
    db.update(timeEntry).set(data).where(eq(timeEntry.id, id)).run();
    audit('time_entry', id, 'update', data);
    return getTimeEntry(id);
  });
}

/** Unbilled entries only; an entry on any invoice cannot be deleted (trigger time_entry_no_delete_billed). */
export function deleteTimeEntry(id: number): void {
  db.transaction(() => {
    const e = getTimeEntry(id);
    assertUnbilled(e);
    db.delete(timeEntry).where(eq(timeEntry.id, id)).run();
    audit('time_entry', id, 'delete', { customerId: e.customerId, date: e.date, minutes: e.minutes, description: e.description });
  });
}

export interface UnbilledSummary {
  customerId: number;
  customerName: string;
  hourlyRateOre: number | null;
  entries: number;
  minutes: number;
  hours: number;
  /** Logged time at the customer's rate; null when the customer has no rate. */
  valueOre: number | null;
  firstDate: string;
  lastDate: string;
}

/** Billable time not on any invoice yet, per customer. */
export function unbilledSummary(customerId?: number): UnbilledSummary[] {
  const rows = db
    .select({
      customerId: timeEntry.customerId,
      customerName: customer.name,
      hourlyRateOre: customer.hourlyRateOre,
      entries: sql<number>`count(*)`,
      minutes: sql<number>`sum(${timeEntry.minutes})`,
      firstDate: sql<string>`min(${timeEntry.date})`,
      lastDate: sql<string>`max(${timeEntry.date})`
    })
    .from(timeEntry)
    .innerJoin(customer, eq(customer.id, timeEntry.customerId))
    .where(and(isNull(timeEntry.invoiceId), eq(timeEntry.billable, true), customerId ? eq(timeEntry.customerId, customerId) : undefined))
    .groupBy(timeEntry.customerId)
    .orderBy(asc(customer.name))
    .all();
  return rows.map((r) => ({
    ...r,
    hours: minutesToHours(r.minutes),
    valueOre: r.hourlyRateOre === null ? null : roundOre((r.minutes * r.hourlyRateOre) / 60)
  }));
}

export function countUnbilled(): number {
  return db.select({ n: sql<number>`count(*)` }).from(timeEntry).where(and(isNull(timeEntry.invoiceId), eq(timeEntry.billable, true))).get()?.n ?? 0;
}

/** Total logged minutes for one customer on one day, so a double log (an assistant retrying) is easy to spot. */
export function dayTotal(customerId: number, date: string): { entries: TimeEntryRow[]; minutes: number } {
  const entries = listTimeEntries({ customerId, from: date, to: date });
  return { entries, minutes: entries.reduce((s, e) => s + e.minutes, 0) };
}

// ------------------------------------------------------------------------------------------------ on a draft

/** One row of the time section of a draft, in print order. An indented entry belongs to the heading above it. */
export const timeRowSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('group'), description: descriptionSchema }),
  z.object({
    type: z.literal('entry'),
    entryId: z.coerce.number({ error: 'Ugyldig registrering' }).int('Ugyldig registrering').positive('Ugyldig registrering'),
    indent: z.boolean().default(false),
    invoicedHours: hoursSchema('Fakturerede timer').optional(),
    invoicedDescription: descriptionSchema.optional(),
    /** undefined keeps the current rate (or the customer's, for a new entry); null = no rate yet. */
    rateOre: z.union([z.null(), rateSchema]).optional()
  })
]);
export type TimeRowInput = z.infer<typeof timeRowSchema>;
export const timeRowsSchema = z.array(timeRowSchema).max(500, 'Højst 500 timelinjer pr. faktura');

export interface GeneratedLine {
  description: string;
  quantity: number;
  unit: string;
  unitPriceOre: number;
  lineTotalOre: number;
  kind: 'time' | 'time_group';
}

export interface DraftTimeEntry {
  type: 'entry';
  entryId: number;
  indent: boolean;
  date: string;
  minutes: number;
  /** Logged hours, two decimals. */
  hours: number;
  description: string;
  invoicedHours: number;
  invoicedDescription: string;
  rateOre: number | null;
  standardRateOre: number | null;
  lineTotalOre: number;
  /** Logged time at the standard rate (the customer's rate when the entry was put on the draft). */
  loggedValueOre: number | null;
  diffHours: number;
  diffOre: number | null;
}

export interface DraftTimeGroup {
  type: 'group';
  description: string;
  hours: number;
  invoicedHours: number;
  /** Total / hours rounded to whole øre; the printed unit price. */
  rateOre: number;
  lineTotalOre: number;
  loggedValueOre: number | null;
  diffHours: number;
  diffOre: number | null;
  entries: number;
}

export type DraftTimeRow = DraftTimeEntry | DraftTimeGroup;

export interface InvoiceTime {
  rows: DraftTimeRow[];
  totals: { entries: number; hours: number; invoicedHours: number; lineTotalOre: number; loggedValueOre: number | null; diffHours: number; diffOre: number | null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function entryView(e: TimeEntry, indent: boolean): DraftTimeEntry {
  const invoicedHours = e.invoicedHours ?? minutesToHours(e.minutes);
  const lineTotal = lineTotalOre(invoicedHours, e.rateOre ?? 0);
  const standard = e.standardRateOre ?? e.rateOre;
  const loggedValueOre = standard === null ? null : roundOre((e.minutes * standard) / 60);
  return {
    type: 'entry',
    entryId: e.id,
    indent,
    date: e.date,
    minutes: e.minutes,
    hours: minutesToHours(e.minutes),
    description: e.description,
    invoicedHours,
    invoicedDescription: e.invoicedDescription ?? e.description,
    rateOre: e.rateOre,
    standardRateOre: e.standardRateOre,
    lineTotalOre: lineTotal,
    loggedValueOre,
    diffHours: round2(invoicedHours - e.minutes / 60),
    diffOre: loggedValueOre === null ? null : lineTotal - loggedValueOre
  };
}

function sumNullable(values: (number | null)[]): number | null {
  return values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + (v ?? 0), 0);
}

/** The time section of an invoice as stored, with logged vs invoiced figures per entry and per heading. */
export function invoiceTime(invoiceId: number): InvoiceTime {
  const groups = db.select().from(timeGroup).where(eq(timeGroup.invoiceId, invoiceId)).all();
  const entries = db.select().from(timeEntry).where(eq(timeEntry.invoiceId, invoiceId)).all();
  const items: { position: number; group?: (typeof groups)[number]; entry?: TimeEntry }[] = [
    ...groups.map((g) => ({ position: g.position, group: g })),
    ...entries.map((e) => ({ position: e.position ?? 0, entry: e }))
  ];
  items.sort((a, b) => a.position - b.position || (a.group ? -1 : 1));

  const rows: DraftTimeRow[] = [];
  let current: DraftTimeGroup | null = null;
  let members: DraftTimeEntry[] = [];
  const closeGroup = () => {
    if (!current) return;
    current.entries = members.length;
    current.hours = round2(members.reduce((s, m) => s + m.minutes, 0) / 60);
    current.invoicedHours = round2(members.reduce((s, m) => s + m.invoicedHours, 0));
    current.lineTotalOre = members.reduce((s, m) => s + m.lineTotalOre, 0);
    current.rateOre = current.invoicedHours ? roundOre(current.lineTotalOre / current.invoicedHours) : 0;
    current.loggedValueOre = sumNullable(members.map((m) => m.loggedValueOre));
    current.diffHours = round2(members.reduce((s, m) => s + m.diffHours, 0));
    current.diffOre = current.loggedValueOre === null ? null : current.lineTotalOre - current.loggedValueOre;
    current = null;
    members = [];
  };
  for (const it of items) {
    if (it.group) {
      closeGroup();
      current = { type: 'group', description: it.group.description, hours: 0, invoicedHours: 0, rateOre: 0, lineTotalOre: 0, loggedValueOre: null, diffHours: 0, diffOre: null, entries: 0 };
      rows.push(current);
      continue;
    }
    const e = it.entry!;
    const indented = e.groupId !== null && current !== null;
    if (!indented) closeGroup();
    const view = entryView(e, indented);
    if (indented) members.push(view);
    rows.push(view);
  }
  closeGroup();

  const all = rows.filter((r): r is DraftTimeEntry => r.type === 'entry');
  const lineTotal = all.reduce((s, r) => s + r.lineTotalOre, 0);
  const logged = sumNullable(all.map((r) => r.loggedValueOre));
  return {
    rows,
    totals: {
      entries: all.length,
      hours: round2(all.reduce((s, r) => s + r.minutes, 0) / 60),
      invoicedHours: round2(all.reduce((s, r) => s + r.invoicedHours, 0)),
      lineTotalOre: lineTotal,
      loggedValueOre: logged,
      diffHours: round2(all.reduce((s, r) => s + r.diffHours, 0)),
      diffOre: logged === null ? null : lineTotal - logged
    }
  };
}

/** The invoice lines the time section prints as: one per heading (sums of its entries), one per loose entry. */
export function linesFromTime(t: InvoiceTime): GeneratedLine[] {
  const lines: GeneratedLine[] = [];
  for (const r of t.rows) {
    if (r.type === 'group') {
      if (r.entries > 0) lines.push({ description: r.description, quantity: r.invoicedHours, unit: 'time', unitPriceOre: r.rateOre, lineTotalOre: r.lineTotalOre, kind: 'time_group' });
    } else if (!r.indent) {
      lines.push({ description: r.invoicedDescription, quantity: r.invoicedHours, unit: 'time', unitPriceOre: r.rateOre ?? 0, lineTotalOre: r.lineTotalOre, kind: 'time' });
    }
  }
  return lines;
}

const RELEASED = { invoiceId: null, groupId: null, position: null, invoicedHours: null, invoicedDescription: null, rateOre: null, standardRateOre: null } as const;

/**
 * Store the time section of draft `invoiceId` from `rows` (in print order). Entries that are no longer listed are
 * released; new ones must be unbilled, billable and belong to the draft's customer. Must run inside the draft's
 * transaction. Without rows the stored section is kept and only checked against the customer.
 */
export function applyTimeRows(invoiceId: number, customerId: number, rows: TimeRowInput[] | undefined): void {
  const current = db.select().from(timeEntry).where(eq(timeEntry.invoiceId, invoiceId)).all();
  if (rows === undefined) {
    const foreign = current.find((e) => e.customerId !== customerId);
    if (foreign) throw badRequest('Kladden har timer for en anden kunde; fjern dem, før du skifter kunde');
    return;
  }

  const entryRows = rows.filter((r): r is Extract<TimeRowInput, { type: 'entry' }> => r.type === 'entry');
  const ids = entryRows.map((r) => r.entryId);
  if (new Set(ids).size !== ids.length) throw badRequest('Den samme registrering står flere gange på kladden');
  const found = ids.length ? db.select().from(timeEntry).where(inArray(timeEntry.id, ids)).all() : [];
  const byId = new Map(found.map((e) => [e.id, e]));
  const cust = requireCustomer(customerId);

  // Indented entries belong to the nearest heading above, with only indented entries in between.
  let groupOpen = false;
  rows.forEach((r, i) => {
    if (r.type === 'group') groupOpen = true;
    else if (r.indent && !groupOpen) throw badRequest(`Timelinje ${i + 1} er indrykket, men har ingen overskrift over sig`);
    else if (!r.indent) groupOpen = false;
  });
  for (const r of entryRows) {
    const e = byId.get(r.entryId);
    if (!e) throw badRequest(`Registrering ${r.entryId} findes ikke`);
    if (e.customerId !== customerId) throw badRequest(`Registrering ${r.entryId} hører til en anden kunde end fakturaens`);
    if (e.invoiceId !== null && e.invoiceId !== invoiceId) throw conflict(`Registrering ${r.entryId} er allerede på en anden faktura`);
    if (e.invoiceId === null && !e.billable) throw badRequest(`Registrering ${r.entryId} er markeret som ikke fakturerbar`);
  }

  const keep = new Set(ids);
  for (const e of current) {
    if (keep.has(e.id)) continue;
    db.update(timeEntry).set(RELEASED).where(eq(timeEntry.id, e.id)).run();
    audit('time_entry', e.id, 'release', { invoiceId });
  }
  // Headings are rebuilt; detach the entries first so the old ones can go.
  db.update(timeEntry).set({ groupId: null }).where(eq(timeEntry.invoiceId, invoiceId)).run();
  db.delete(timeGroup).where(eq(timeGroup.invoiceId, invoiceId)).run();

  let groupId: number | null = null;
  const now = new Date().toISOString();
  rows.forEach((r, position) => {
    if (r.type === 'group') {
      groupId = db.insert(timeGroup).values({ invoiceId, position, description: r.description, createdAt: now }).returning().get().id;
      return;
    }
    const e = byId.get(r.entryId)!;
    const added = e.invoiceId === null;
    if (!r.indent) groupId = null;
    const rate = r.rateOre !== undefined ? r.rateOre : added ? cust.hourlyRateOre : e.rateOre;
    db.update(timeEntry)
      .set({
        invoiceId,
        groupId: r.indent ? groupId : null,
        position,
        invoicedHours: r.invoicedHours ?? (added ? minutesToHours(e.minutes) : (e.invoicedHours ?? minutesToHours(e.minutes))),
        invoicedDescription: r.invoicedDescription ?? (added ? e.description : (e.invoicedDescription ?? e.description)),
        rateOre: rate,
        standardRateOre: added ? cust.hourlyRateOre : e.standardRateOre
      })
      .where(eq(timeEntry.id, e.id))
      .run();
    if (added) audit('time_entry', e.id, 'attach', { invoiceId });
  });
}

/** Deleting a draft gives its time back: the entries become unbilled again with their logged values untouched. */
export function releaseDraftTime(invoiceId: number): number {
  const entries = db.select({ id: timeEntry.id }).from(timeEntry).where(eq(timeEntry.invoiceId, invoiceId)).all();
  db.update(timeEntry).set(RELEASED).where(eq(timeEntry.invoiceId, invoiceId)).run();
  db.delete(timeGroup).where(eq(timeGroup.invoiceId, invoiceId)).run();
  for (const e of entries) audit('time_entry', e.id, 'release', { invoiceId, reason: 'draft_deleted' });
  return entries.length;
}

/** Problems that block issuing a draft with time on it. */
export function timeIssueProblems(t: InvoiceTime): string[] {
  const problems: string[] = [];
  const noRate = t.rows.filter((r) => r.type === 'entry' && r.rateOre === null).length;
  if (noRate) problems.push(`${noRate} ${noRate === 1 ? 'timelinje mangler' : 'timelinjer mangler'} en timepris`);
  for (const r of t.rows) if (r.type === 'group' && r.entries === 0) problems.push(`Overskriften »${r.description}« har ingen timer under sig`);
  return problems;
}

/** Rows for a new draft: the given entries (default: every unbilled billable entry of the customer), oldest first. */
export function rowsForNewDraft(customerId: number, entryIds?: number[]): TimeRowInput[] {
  const unbilled = listTimeEntries({ customerId, status: 'unbilled' });
  const chosen = entryIds ? unbilled.filter((e) => entryIds.includes(e.id)) : unbilled;
  if (entryIds) {
    const missing = entryIds.filter((id) => !chosen.some((e) => e.id === id));
    if (missing.length) throw badRequest(`Registrering ${missing.join(', ')} er ikke ufaktureret tid for kunden`);
  }
  if (chosen.length === 0) throw badRequest('Kunden har ingen ufakturerede timer');
  return chosen
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((e) => ({ type: 'entry', entryId: e.id, indent: false }));
}
