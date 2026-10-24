import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createTimeEntry, deleteTimeEntry, listTimeEntries, unbilledSummary, updateTimeEntry } from '$lib/server/services/time';
import { createDraftFromTime } from '$lib/server/services/invoices';
import { listCustomers } from '$lib/server/services/customers';
import { errorMessage, formValues, isRedirect } from '$lib/server/api';
import { HttpError } from '$lib/server/errors';
import { parseDateInput, parseHoursToMinutes, todayIso } from '$lib/format';

const STATUSES = ['unbilled', 'draft', 'billed', 'not_billable'] as const;

export const load: PageServerLoad = ({ url }) => {
  const customerId = Number(url.searchParams.get('kunde')) || undefined;
  const raw = url.searchParams.get('status') ?? '';
  const status = (STATUSES as readonly string[]).includes(raw) ? raw : undefined;
  return {
    today: todayIso(),
    customers: listCustomers(),
    filter: { customerId: customerId ?? null, status: status ?? null },
    rows: listTimeEntries({ customerId, status }),
    unbilled: unbilledSummary()
  };
};

/** The logged fields of the form, as the service takes them. */
function entryFromForm(form: FormData) {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const fields: Record<string, string> = {};
  let minutes = 0;
  let date = '';
  try {
    minutes = parseHoursToMinutes(str('hours'));
  } catch (e) {
    fields.hours = (e as Error).message;
  }
  try {
    date = parseDateInput(str('date'));
  } catch {
    fields.date = 'Ugyldig dato – brug dd.mm.åååå';
  }
  if (Object.keys(fields).length) throw new HttpError(400, Object.values(fields).join('; '), fields);
  return { customerId: str('customerId'), date, minutes, description: str('description'), billable: form.get('billable') === 'on' };
}

async function run(form: FormData, fn: () => unknown) {
  try {
    await fn();
  } catch (e) {
    if (isRedirect(e)) throw e;
    const { status, message } = errorMessage(e);
    const fields = e instanceof HttpError && Object.keys(e.fields).length ? e.fields : undefined;
    return fail(status, { error: message, fields, values: formValues(form), entryId: Number(form.get('id')) || null });
  }
  return { ok: true };
}

export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    return run(form, () => createTimeEntry(entryFromForm(form)));
  },
  update: async ({ request }) => {
    const form = await request.formData();
    return run(form, () => updateTimeEntry(Number(form.get('id')), entryFromForm(form)));
  },
  /** Flip "fakturerbar" on an unbilled entry without opening it. */
  billable: async ({ request }) => {
    const form = await request.formData();
    return run(form, () => updateTimeEntry(Number(form.get('id')), { billable: form.get('billable') === 'true' }));
  },
  delete: async ({ request }) => {
    const form = await request.formData();
    return run(form, () => deleteTimeEntry(Number(form.get('id'))));
  },
  /** "Fakturér timer": a new draft with every unbilled billable entry of the customer. */
  bill: async ({ request }) => {
    const form = await request.formData();
    return run(form, async () => {
      const draft = await createDraftFromTime({ customerId: form.get('customerId') });
      redirect(303, `/fakturaer/${draft.id}`);
    });
  }
};
