import type { RequestHandler } from './$types';
import { api, idParam, readJson } from '$lib/server/api';
import { deleteSupplier, getSupplier, renameSupplier } from '$lib/server/services/suppliers';

export const GET: RequestHandler = (event) => api(() => getSupplier(idParam(event)));

/** Rename: `{ name }`. Expenses follow the row, so every bilag on the supplier shows the new name. */
export const PUT: RequestHandler = (event) => api(async () => renameSupplier(idParam(event), await readJson(event.request)));

/** 409 while any expense references the supplier. */
export const DELETE: RequestHandler = (event) =>
  api(() => {
    deleteSupplier(idParam(event));
    return { ok: true };
  });
