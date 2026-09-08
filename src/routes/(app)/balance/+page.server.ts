import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { balance, reconcileBook, reconcilePreview } from '$lib/server/services/finance';
import { errorMessage } from '$lib/server/api';
import { parseKrToOre } from '$lib/format';
import { badRequest, HttpError } from '$lib/server/errors';

export const load: PageServerLoad = () => ({ balance: balance() });

function actualFrom(form: FormData): number {
  try {
    return parseKrToOre(String(form.get('actual') ?? ''));
  } catch {
    throw badRequest('Indtast bankens saldo, fx 105.305,00', { actual: 'Ugyldigt beløb' });
  }
}

export const actions: Actions = {
  /** Step 1: compare the bank's figure with Likvider. */
  reconcile: async ({ request }) => {
    const form = await request.formData();
    try {
      return { preview: reconcilePreview(actualFrom(form)) };
    } catch (e) {
      const { status, message } = errorMessage(e);
      const fields = e instanceof HttpError && Object.keys(e.fields).length ? e.fields : undefined;
      return fail(status, { error: message, fields });
    }
  },
  /** Step 2: book the difference as a `correction` movement. */
  book: async ({ request }) => {
    const form = await request.formData();
    try {
      const expectedRaw = String(form.get('expectedLikvider') ?? '').trim();
      const expected = expectedRaw === '' ? undefined : parseKrToOre(expectedRaw);
      const movement = reconcileBook(actualFrom(form), expected);
      return { booked: movement };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  }
};
