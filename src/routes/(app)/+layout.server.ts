import type { LayoutServerLoad } from './$types';
import { countRows } from '$lib/server/db';
import { customer, expense, invoice } from '$lib/server/schema';
import { getSettings } from '$lib/server/services/settings';
import { countUnbilled } from '$lib/server/services/time';
import { formatDate, quarterOf, QUARTER_LABELS, todayIso, vatSettlementDate } from '$lib/format';
import { parseTheme, THEME_COOKIE } from '$lib/theme';

export const load: LayoutServerLoad = ({ cookies }) => {
  const s = getSettings();
  const today = todayIso();
  const q = quarterOf(today);
  return {
    counts: { invoices: countRows(invoice), customers: countRows(customer), expenses: countRows(expense), unbilledTime: countUnbilled() },
    companyName: s.company_name,
    context: `Regnskabsår ${q.year} · ${QUARTER_LABELS[q.quarter]}`,
    /** The rail footer and topbar pin the current quarter's VAT deadline: this app exists because of that date. */
    vatDeadline: { quarter: q.quarter, year: q.year, date: formatDate(vatSettlementDate(q.year, q.quarter)) },
    /** "Kompakt" table density, per user (cookie). */
    dense: cookies.get('faktura_density') === 'dense',
    /** Colour theme, per browser (cookie); applied to <html> in hooks.server.ts. */
    theme: parseTheme(cookies.get(THEME_COOKIE))
  };
};
