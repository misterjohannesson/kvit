import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { deleteCustomer, getCustomer, updateCustomer } from '$lib/server/services/customers';
import { listInvoices } from '$lib/server/services/invoices';
import { errorMessage } from '$lib/server/api';
import { HttpError } from '$lib/server/errors';
import { customerFormToInput } from '$lib/server/customer-form';
import { todayIso } from '$lib/format';

function id(params: { id: string }): number {
  const n = Number(params.id);
  if (!Number.isInteger(n) || n <= 0) error(404, 'Kunde findes ikke');
  return n;
}

export const load: PageServerLoad = ({ params }) => {
  try {
    const c = getCustomer(id(params));
    return { today: todayIso(), customer: c, invoices: listInvoices().filter((i) => i.customerId === c.id) };
  } catch (e) {
    if (e instanceof HttpError) error(e.status, e.message);
    throw e;
  }
};

export const actions: Actions = {
  save: async ({ params, request }) => {
    try {
      updateCustomer(id(params), customerFormToInput(await request.formData()));
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },
  delete: async ({ params }) => {
    try {
      deleteCustomer(id(params));
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
    redirect(303, '/kunder');
  }
};
