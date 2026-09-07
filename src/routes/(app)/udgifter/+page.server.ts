import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createExpense, listCategories, listExpenses, listExpenseYears } from '$lib/server/services/expenses';
import { formDataToExpense, uploadFromForm } from '$lib/server/expense-form';
import { errorMessage } from '$lib/server/api';
import { todayIso } from '$lib/format';

export const load: PageServerLoad = ({ url }) => {
  const yearParam = url.searchParams.get('year');
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;
  return {
    today: todayIso(),
    year,
    years: listExpenseYears(),
    rows: listExpenses({ year }),
    categories: listCategories()
  };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    try {
      const e = createExpense(formDataToExpense(form), await uploadFromForm(form));
      redirect(303, `/udgifter/${e.id}`);
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
      const { status, message } = errorMessage(e);
      const values: Record<string, string> = {};
      for (const [k, v] of form.entries()) if (typeof v === 'string') values[k] = v;
      return fail(status, { error: message, values });
    }
  }
};
