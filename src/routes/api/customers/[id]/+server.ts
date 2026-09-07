import type { RequestHandler } from './$types';
import { api, idParam, readJson } from '$lib/server/api';
import { deleteCustomer, getCustomer, updateCustomer } from '$lib/server/services/customers';

export const GET: RequestHandler = (event) => api(() => getCustomer(idParam(event)));

export const PUT: RequestHandler = (event) =>
  api(async () => updateCustomer(idParam(event), await readJson(event.request)));

export const DELETE: RequestHandler = (event) =>
  api(() => {
    deleteCustomer(idParam(event));
    return { ok: true };
  });
