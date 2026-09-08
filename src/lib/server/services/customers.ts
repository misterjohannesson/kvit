import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { customer, invoice, type Customer } from '../schema';
import { audit } from '../audit';
import { badRequest, conflict, notFound } from '../errors';

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Navn er påkrævet').max(200),
  address: z.string().trim().min(1, 'Adresse er påkrævet').max(200),
  zip: z.string().trim().min(1, 'Postnr. er påkrævet').max(20),
  city: z.string().trim().min(1, 'By er påkrævet').max(100),
  country: z.string().trim().min(2).max(2).toUpperCase().default('DK'),
  cvr: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v.replace(/\s/g, ''))
    .refine((v) => v === '' || /^\d{8}$/.test(v), 'CVR skal være 8 cifre')
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  email: z.string().trim().max(200).default('')
    .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Ugyldig e-mail'),
  /** Days from invoice date to due date; null = the default under settings. */
  paymentTermsDays: z
    .union([z.null(), z.literal(''), z.coerce.number({ error: 'Betalingsfrist skal være et tal' }).int('Betalingsfrist skal være hele dage').min(0, 'Betalingsfrist kan ikke være negativ').max(365, 'Betalingsfrist kan højst være 365 dage')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v))
});

function parse(input: unknown) {
  const r = customerSchema.safeParse(input);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

export function listCustomers(): Customer[] {
  return db.select().from(customer).orderBy(asc(customer.name)).all();
}

export function getCustomer(id: number): Customer {
  const c = db.select().from(customer).where(eq(customer.id, id)).get();
  if (!c) throw notFound('Kunde findes ikke');
  return c;
}

export function createCustomer(input: unknown): Customer {
  const data = parse(input);
  return db.transaction(() => {
    const row = db
      .insert(customer)
      .values({ ...data, createdAt: new Date().toISOString() })
      .returning()
      .get();
    audit('customer', row.id, 'create', data);
    return row;
  });
}

/** Editing a customer never touches issued invoices or their PDFs. */
export function updateCustomer(id: number, input: unknown): Customer {
  const data = parse(input);
  return db.transaction(() => {
    getCustomer(id);
    const row = db.update(customer).set(data).where(eq(customer.id, id)).returning().get();
    audit('customer', id, 'update', data);
    return row;
  });
}

export function deleteCustomer(id: number): void {
  db.transaction(() => {
    getCustomer(id);
    const used = db
      .select({ n: sql<number>`count(*)` })
      .from(invoice)
      .where(eq(invoice.customerId, id))
      .get();
    if ((used?.n ?? 0) > 0) throw conflict('Kunden har fakturaer og kan ikke slettes');
    db.delete(customer).where(eq(customer.id, id)).run();
    audit('customer', id, 'delete', {});
  });
}
