import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getExpense, updateExpense, uploadExpenseFile } from '$lib/server/services/expenses';
import { selectableAccounts } from '$lib/server/services/accounts';
import { formDataToExpense, uploadFromForm } from '$lib/server/expense-form';
import { errorMessage, formValues, routeId } from '$lib/server/api';
import { HttpError, badRequest } from '$lib/server/errors';

export const load: PageServerLoad = ({ params }) => {
  try {
    const e = getExpense(routeId(params));
    const ext = e.filePath ? e.filePath.split('.').pop() : null;
    return { expense: e, fileKind: ext === 'pdf' ? 'pdf' : ext ? 'image' : null, accounts: selectableAccounts('cost', [e.accountId]) };
  } catch (e) {
    if (e instanceof HttpError) error(e.status, e.message);
    throw e;
  }
};

function failWith(e: unknown, form: FormData) {
  const { status, message } = errorMessage(e);
  const fields = e instanceof HttpError && Object.keys(e.fields).length ? e.fields : undefined;
  return fail(status, { error: message, fields, values: formValues(form) });
}

export const actions: Actions = {
  save: async ({ params, request }) => {
    const form = await request.formData();
    try {
      updateExpense(routeId(params), formDataToExpense(form));
      return { saved: true };
    } catch (e) {
      return failWith(e, form);
    }
  },
  upload: async ({ params, request }) => {
    const form = await request.formData();
    try {
      const file = await uploadFromForm(form);
      if (!file) throw badRequest('Vælg en fil', { file: 'Vælg en fil' });
      uploadExpenseFile(routeId(params), file);
      return { saved: true };
    } catch (e) {
      return failWith(e, form);
    }
  }
};
