import type { RequestHandler } from './$types';
import { api, idParam, readJson } from '$lib/server/api';
import { deleteTimeEntry, getTimeEntry, updateTimeEntry } from '$lib/server/services/time';

export const GET: RequestHandler = (event) => api(() => getTimeEntry(idParam(event)));

/** Change the logged fields of an unbilled entry. 409 once the entry is on an invoice. */
export const PATCH: RequestHandler = (event) => api(async () => updateTimeEntry(idParam(event), await readJson(event.request)));

export const PUT = PATCH;

/** Delete an unbilled entry. 409 once the entry is on an invoice. */
export const DELETE: RequestHandler = (event) =>
  api(() => {
    deleteTimeEntry(idParam(event));
    return { ok: true };
  });
