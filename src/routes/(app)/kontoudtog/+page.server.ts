import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { ledger } from '$lib/server/services/finance';
import { parseDateInput, todayIso } from '$lib/format';
import { isPeriod, PRESETS, presetRange, type Period } from '$lib/periods';

export const load: PageServerLoad = ({ url }) => {
  const today = todayIso();
  const requested = url.searchParams.get('period');
  const period: Period = isPeriod(requested) ? requested : 'this_month';
  let from: string;
  let to: string;
  let dateError: string | null = null;
  if (period === 'custom') {
    try {
      from = parseDateInput(url.searchParams.get('from') ?? '');
      to = parseDateInput(url.searchParams.get('to') ?? '');
      if (to < from) {
        dateError = 'Slutdato ligger før startdato';
        [from, to] = [to, from];
      }
    } catch {
      // A half-typed custom range falls back to this month and says so, rather than failing the page.
      dateError = 'Ugyldig dato – brug dd.mm.åååå';
      ({ from, to } = presetRange('this_month', today));
    }
  } else {
    ({ from, to } = presetRange(period, today));
  }
  try {
    return { today, period, from, to, dateError, presets: PRESETS, ledger: ledger(from, to) };
  } catch (e) {
    if (e instanceof Error && 'status' in e) error((e as { status: number }).status, e.message);
    throw e;
  }
};
