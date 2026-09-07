import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createDraft, listInvoiceYears, listInvoices } from '$lib/server/services/invoices';
import { listCustomers } from '$lib/server/services/customers';
import { errorMessage, isRedirect } from '$lib/server/api';
import { todayIso } from '$lib/format';

export const load: PageServerLoad = ({ url }) => {
  const today = todayIso();
  const filter = url.searchParams.get('status') ?? 'alle';
  const yearParam = url.searchParams.get('year');
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;

  let rows = listInvoices({ year });
  switch (filter) {
    case 'kladder':
      rows = rows.filter((r) => r.status === 'draft');
      break;
    case 'aabne':
      rows = rows.filter((r) => r.status === 'issued' && !r.isCreditNote && !r.paidDate && r.dueDate >= today);
      break;
    case 'forfaldne':
      rows = rows.filter((r) => r.status === 'issued' && !r.isCreditNote && !r.paidDate && r.dueDate < today);
      break;
    case 'betalte':
      rows = rows.filter((r) => r.status === 'issued' && !r.isCreditNote && !!r.paidDate);
      break;
    case 'krediterede':
      rows = rows.filter((r) => r.status === 'credited' || r.isCreditNote);
      break;
  }
  return { today, filter, year, years: listInvoiceYears(), rows, customers: listCustomers() };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    try {
      const draft = createDraft({ customerId: Number(form.get('customerId')) });
      redirect(303, `/fakturaer/${draft.id}`);
    } catch (e) {
      if (isRedirect(e)) throw e;
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  }
};
