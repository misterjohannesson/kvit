import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { customer, expense, invoice } from '$lib/server/schema';
import { sql } from 'drizzle-orm';
import { getSettings } from '$lib/server/services/settings';
import { quarterOf, QUARTER_LABELS, todayIso } from '$lib/format';

export const load: LayoutServerLoad = ({ cookies }) => {
  const count = (t: typeof customer | typeof expense | typeof invoice) =>
    db.select({ n: sql<number>`count(*)` }).from(t).get()?.n ?? 0;
  const s = getSettings();
  const today = todayIso();
  const q = quarterOf(today);
  return {
    counts: { invoices: count(invoice), customers: count(customer), expenses: count(expense) },
    companyName: s.company_name,
    context: `Regnskabsår ${q.year} · ${QUARTER_LABELS[q.quarter]}`,
    /** "Kompakt" table density, per user (cookie). */
    dense: cookies.get('faktura_density') === 'dense'
  };
};
