import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createExpense, listCategories, listExpenses, listExpenseYears } from '$lib/server/services/expenses';
import { formDataToExpense, formValues, uploadFromForm } from '$lib/server/expense-form';
import { errorMessage, isRedirect } from '$lib/server/api';
import { HttpError } from '$lib/server/errors';
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
      if (isRedirect(e)) throw e;
      const { status, message } = errorMessage(e);
      const fields = e instanceof HttpError && Object.keys(e.fields).length ? e.fields : undefined;
      return fail(status, { error: message, fields, values: formValues(form) });
    }
  }
};
