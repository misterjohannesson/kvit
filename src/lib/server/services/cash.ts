import { asc, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { cashMovement, type CashMovement } from '../schema';
import { audit } from '../audit';
import { badRequest } from '../errors';
import { isoDate, oreAmount } from '../zod-shared';

export const MOVEMENT_KINDS = ['vat_payment', 'owner', 'tax', 'correction', 'other'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const KIND_LABELS: Record<MovementKind, string> = {
  vat_payment: 'Momsbetaling',
  owner: 'Ejer (indskud/hævning)',
  tax: 'Skat',
  correction: 'Korrektion',
  other: 'Andet'
};

const movementSchema = z.object({
  date: isoDate,
  description: z.string().trim().min(1, 'Beskrivelse er påkrævet').max(300),
  /** Signed øre: positive = money in, negative = money out. */
  amountOre: oreAmount('Beløb').refine((n) => n !== 0, 'Beløb skal være forskelligt fra 0'),
  kind: z.enum(MOVEMENT_KINDS, { message: 'Ugyldig type' })
});

export function listMovements(filter: { year?: number } = {}): CashMovement[] {
  const rows = db.select().from(cashMovement).orderBy(desc(cashMovement.date), desc(cashMovement.id)).all();
  return filter.year ? rows.filter((m) => m.date.startsWith(`${filter.year}-`)) : rows;
}

export function listMovementsAsc(): CashMovement[] {
  return db.select().from(cashMovement).orderBy(asc(cashMovement.date), asc(cashMovement.id)).all();
}

/** The rows ARE the journal: movements are created, never edited or deleted. Mistakes get a `correction`. */
export function createMovement(input: unknown, auditDetail: Record<string, unknown> = {}): CashMovement {
  const r = movementSchema.safeParse(input);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join('; '));
  return db.transaction(() => {
    const row = db
      .insert(cashMovement)
      .values({ ...r.data, createdAt: new Date().toISOString() })
      .returning()
      .get();
    audit('cash_movement', row.id, 'create', { ...r.data, ...auditDetail });
    return row;
  });
}
