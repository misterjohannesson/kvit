import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { deleteCustomer, getCustomer, updateCustomer } from '$lib/server/services/customers';
import { createDraftFromTime, listInvoices } from '$lib/server/services/invoices';
import { listTimeEntries, unbilledSummary } from '$lib/server/services/time';
import { errorMessage, routeId } from '$lib/server/api';
import { HttpError } from '$lib/server/errors';
import { customerFormToInput } from '$lib/server/customer-form';
import { todayIso } from '$lib/format';
import { getSettings } from '$lib/server/services/settings';

export const load: PageServerLoad = ({ params }) => {
  try {
    const c = getCustomer(routeId(params));
    return {
      today: todayIso(),
      customer: c,
      invoices: listInvoices().filter((i) => i.customerId === c.id),
      defaultTermsDays: Number(getSettings().payment_terms_days) || 0,
      unbilled: unbilledSummary(c.id)[0] ?? null,
      time: listTimeEntries({ customerId: c.id }).slice(0, 25),
      timeCount: listTimeEntries({ customerId: c.id }).length
    };
  } catch (e) {
    if (e instanceof HttpError) error(e.status, e.message);
    throw e;
  }
};

export const actions: Actions = {
  save: async ({ params, request }) => {
    try {
      updateCustomer(routeId(params), customerFormToInput(await request.formData()));
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },
  /** "Fakturér timer": a new draft with the customer's unbilled time. */
  bill: async ({ params }) => {
    let id: number;
    try {
      id = (await createDraftFromTime({ customerId: routeId(params) })).id;
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
    redirect(303, `/fakturaer/${id}`);
  },
  delete: async ({ params }) => {
    try {
      deleteCustomer(routeId(params));
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
    redirect(303, '/kunder');
  }
};
