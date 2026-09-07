import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createExpense, listExpenses } from '$lib/server/services/expenses';
import { formDataToExpense, uploadFromForm } from '$lib/server/expense-form';

export const GET: RequestHandler = ({ url }) =>
  api(() => listExpenses({ year: url.searchParams.get('year') ? Number(url.searchParams.get('year')) : undefined }));

/** JSON body, or multipart form with the same fields plus an optional `file`. */
export const POST: RequestHandler = ({ request }) =>
  api(async () => {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      const form = await request.formData();
      return createExpense(formDataToExpense(form), await uploadFromForm(form));
    }
    return createExpense(await readJson(request), null);
  }, 201);
