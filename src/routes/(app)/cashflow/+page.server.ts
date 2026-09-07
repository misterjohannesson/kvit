import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { cashflow } from '$lib/server/services/finance';
import { createMovement, KIND_LABELS, listMovements, MOVEMENT_KINDS } from '$lib/server/services/cash';
import { errorMessage, formValues } from '$lib/server/api';
import { parseDateInput, parseKrToOre, todayIso } from '$lib/format';
import { badRequest } from '$lib/server/errors';

export const load: PageServerLoad = () => ({
  today: todayIso(),
  flow: cashflow(),
  movements: listMovements(),
  kinds: MOVEMENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))
});

export const actions: Actions = {
  /** Inline form: date, description, amount (signed, Danish format), kind. */
  create: async ({ request }) => {
    const form = await request.formData();
    const str = (k: string) => String(form.get(k) ?? '').trim();
    const fields: Record<string, string> = {};
    let date = '';
    let amountOre = 0;
    try {
      date = parseDateInput(str('date'));
    } catch {
      fields.date = 'Ugyldig dato – brug dd.mm.åååå';
    }
    try {
      amountOre = parseKrToOre(str('amount'));
      if (amountOre === 0) fields.amount = 'Beløb skal være forskelligt fra 0';
    } catch {
      fields.amount = 'Ugyldigt beløb – fortegn angiver retning (−1.000,00 = ud)';
    }
    if (!str('description')) fields.description = 'Skal udfyldes';
    try {
      if (Object.keys(fields).length) throw badRequest('Ret de markerede felter', fields);
      createMovement({ date, description: str('description'), amountOre, kind: str('kind') });
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      const f = e instanceof Error && 'fields' in e ? (e as { fields: Record<string, string> }).fields : undefined;
      return fail(status, { error: message, fields: f && Object.keys(f).length ? f : undefined, values: formValues(form) });
    }
  }
};
