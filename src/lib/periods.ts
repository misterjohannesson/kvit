/** Date windows behind the Kontoudtog preset buttons, from today's date in Europe/Copenhagen. */
import { addDays, monthOf, nextMonth, quarterOf, quarterRange, todayIso } from './format';

export type Period = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'custom';
export type PresetPeriod = Exclude<Period, 'custom'>;

export const PRESETS: { key: PresetPeriod; label: string }[] = [
  { key: 'this_month', label: 'Denne måned' },
  { key: 'last_month', label: 'Sidste måned' },
  { key: 'this_quarter', label: 'Dette kvartal' },
  { key: 'last_quarter', label: 'Sidste kvartal' },
  { key: 'this_year', label: 'I år' }
];

export function isPeriod(v: string | null): v is Period {
  return v !== null && [...PRESETS.map((p) => p.key), 'custom'].includes(v);
}

export function presetRange(period: PresetPeriod, today = todayIso()): { from: string; to: string } {
  const ym = monthOf(today);
  const monthRange = (m: string) => ({ from: `${m}-01`, to: addDays(`${nextMonth(m)}-01`, -1) });
  const q = quarterOf(today);
  switch (period) {
    case 'this_month':
      return monthRange(ym);
    case 'last_month':
      return monthRange(addDays(`${ym}-01`, -1).slice(0, 7));
    case 'this_quarter':
      return quarterRange(q.year, q.quarter);
    case 'last_quarter':
      return q.quarter === 1 ? quarterRange(q.year - 1, 4) : quarterRange(q.year, q.quarter - 1);
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}
