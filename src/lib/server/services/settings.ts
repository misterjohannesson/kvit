import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { setting } from '../schema';
import { audit } from '../audit';
import { badRequest } from '../errors';
import { DEFAULT_SETTINGS, SETTING_KEYS } from './settings-defaults';
import { withIssueLock } from './issue-lock';

export type Settings = Record<string, string>;

export function getSettings(): Settings {
  const rows = db.select().from(setting).all();
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSettingRaw(key: string, value: string): void {
  db.insert(setting)
    .values({ key, value })
    .onConflictDoUpdate({ target: setting.key, set: { value } })
    .run();
}

const settingsSchema = z.object({
  company_name: z.string().trim().max(200).optional(),
  company_address: z.string().trim().max(200).optional(),
  company_zip: z.string().trim().max(20).optional(),
  company_city: z.string().trim().max(100).optional(),
  company_cvr: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === '' || /^\d{8}$/.test(v.replace(/\s/g, '')), 'CVR skal være 8 cifre')
    .optional(),
  bank_reg: z.string().trim().max(10).optional(),
  bank_account: z.string().trim().max(20).optional(),
  payment_terms_days: z
    .union([z.number(), z.string().regex(/^\d+$/, 'Betalingsfrist skal være et helt antal dage')])
    .transform(Number)
    .pipe(z.number().int().min(0).max(365))
    .optional(),
  next_invoice_number: z
    .union([z.number(), z.string().regex(/^\d+$/, 'Fakturanummer skal være et helt tal')])
    .transform(Number)
    .pipe(z.number().int().min(1))
    .optional(),
  opening_balance_ore: z
    .union([z.number(), z.string().regex(/^-?\d+$/, 'Åbningssaldo skal være hele øre')])
    .transform(Number)
    .pipe(z.number().int())
    .optional(),
  opening_balance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato skal være åååå-mm-dd').optional(),
  vat_registered: z
    .union([z.literal('1'), z.literal('0'), z.literal('on'), z.boolean()])
    .transform((v) => (v === true || v === '1' || v === 'on' ? '1' : '0'))
    .optional()
});

/**
 * Update settings. next_invoice_number may only move upward and the change is
 * audit-logged. Runs under the issue lock so it can never race an issue.
 */
export async function updateSettings(input: unknown): Promise<Settings> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const data = parsed.data;

  return withIssueLock(async () => {
    const before = getSettings();
    const changes: Record<string, { from: string; to: string }> = {};

    db.transaction((tx) => {
      for (const key of SETTING_KEYS) {
        if (!(key in data)) continue;
        const raw = (data as Record<string, unknown>)[key];
        if (raw === undefined) continue;
        const value = String(raw);
        if (key === 'next_invoice_number') {
          const current = Number(before.next_invoice_number);
          const next = Number(value);
          if (next < current) {
            throw badRequest(`Næste fakturanummer kan kun sættes op (nuværende: ${current})`);
          }
        }
        if (before[key] !== value) {
          changes[key] = { from: before[key], to: value };
          tx.insert(setting)
            .values({ key, value })
            .onConflictDoUpdate({ target: setting.key, set: { value } })
            .run();
        }
      }
      if (Object.keys(changes).length > 0) {
        audit('setting', 0, 'update', changes);
      }
    });
    return getSettings();
  });
}

/** True when the company details needed on a legal invoice are present. */
export function companyDetailsComplete(s: Settings): string[] {
  const missing: string[] = [];
  if (!s.company_name) missing.push('firmanavn');
  if (!s.company_address) missing.push('adresse');
  if (!s.company_zip || !s.company_city) missing.push('postnr./by');
  if (!s.company_cvr) missing.push('CVR-nummer');
  return missing;
}
