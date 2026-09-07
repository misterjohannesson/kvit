import type { LayoutServerLoad } from './$types';
import { countRows } from '$lib/server/db';
import { customer, expense, invoice } from '$lib/server/schema';
import { getSettings } from '$lib/server/services/settings';
import { quarterOf, QUARTER_LABELS, todayIso } from '$lib/format';

export const load: LayoutServerLoad = ({ cookies }) => {
  const s = getSettings();
  const today = todayIso();
  const q = quarterOf(today);
  return {
    counts: { invoices: countRows(invoice), customers: countRows(customer), expenses: countRows(expense) },
    companyName: s.company_name,
    context: `Regnskabsår ${q.year} · ${QUARTER_LABELS[q.quarter]}`,
    /** "Kompakt" table density, per user (cookie). */
    dense: cookies.get('faktura_density') === 'dense'
  };
};
