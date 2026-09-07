import type { RequestHandler } from './$types';
import { api, idParam, readJson } from '$lib/server/api';
import { getExpense, updateExpense } from '$lib/server/services/expenses';

export const GET: RequestHandler = (event) => api(() => getExpense(idParam(event)));

export const PUT: RequestHandler = (event) =>
  api(async () => updateExpense(idParam(event), await readJson(event.request)));
