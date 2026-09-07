import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getExpense, listCategories, updateExpense, uploadExpenseFile } from '$lib/server/services/expenses';
import { formDataToExpense, uploadFromForm } from '$lib/server/expense-form';
import { errorMessage } from '$lib/server/api';
import { HttpError, badRequest } from '$lib/server/errors';

function id(params: { id: string }): number {
  const n = Number(params.id);
  if (!Number.isInteger(n) || n <= 0) error(404, 'Udgift findes ikke');
  return n;
}

export const load: PageServerLoad = ({ params }) => {
  try {
    const e = getExpense(id(params));
    const ext = e.filePath ? e.filePath.split('.').pop() : null;
    return { expense: e, fileKind: ext === 'pdf' ? 'pdf' : ext ? 'image' : null, categories: listCategories() };
  } catch (e) {
    if (e instanceof HttpError) error(e.status, e.message);
    throw e;
  }
};

export const actions: Actions = {
  save: async ({ params, request }) => {
    const form = await request.formData();
    try {
      updateExpense(id(params), formDataToExpense(form));
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  },
  upload: async ({ params, request }) => {
    const form = await request.formData();
    try {
      const file = await uploadFromForm(form);
      if (!file) throw badRequest('Vælg en fil');
      uploadExpenseFile(id(params), file);
      return { saved: true };
    } catch (e) {
      const { status, message } = errorMessage(e);
      return fail(status, { error: message });
    }
  }
};
