import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createCustomer, listCustomers } from '$lib/server/services/customers';
import { errorMessage } from '$lib/server/api';
import { customerFormToInput } from '$lib/server/customer-form';
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
  return { customers: listCustomers().map((c) => ({ ...c, invoiceCount: counts.get(c.id) ?? 0 })) };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    try {
      const c = createCustomer(customerFormToInput(form));
      redirect(303, `/kunder/${c.id}`);
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
      const { status, message } = errorMessage(e);
      const values: Record<string, string> = {};
      for (const [k, v] of form.entries()) if (typeof v === 'string') values[k] = v;
      return fail(status, { error: message, values });
    }
  }
};
