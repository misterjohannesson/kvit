import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createCustomer, listCustomers } from '$lib/server/services/customers';
import { errorMessage, formValues, isRedirect } from '$lib/server/api';
import { customerFormToInput } from '$lib/server/customer-form';
import { getSettings } from '$lib/server/services/settings';
import { db } from '$lib/server/db';
import { invoice } from '$lib/server/schema';
import { sql } from 'drizzle-orm';

export const load: PageServerLoad = () => {
  const counts = new Map(
    db
      .select({ customerId: invoice.customerId, n: sql<number>`count(*)` })
      .from(invoice)
      .groupBy(invoice.customerId)
      .all()
      .map((r) => [r.customerId, r.n])
  );
  return {
    customers: listCustomers().map((c) => ({ ...c, invoiceCount: counts.get(c.id) ?? 0 })),
    defaultTermsDays: Number(getSettings().payment_terms_days) || 0
  };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    try {
      const c = createCustomer(customerFormToInput(form));
      redirect(303, `/kunder/${c.id}`);
    } catch (e) {
      if (isRedirect(e)) throw e;
      const { status, message } = errorMessage(e);
      return fail(status, { error: message, values: formValues(form) });
    }
  }
};
