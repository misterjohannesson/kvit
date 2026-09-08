import type { RequestHandler } from './$types';
import { api, idParam, readJson } from '$lib/server/api';
import { deleteAccount, getAccount, renameAccount } from '$lib/server/services/accounts';

export const GET: RequestHandler = (event) => api(() => getAccount(idParam(event)));

/** Rename only; number and type are fixed once created. */
export const PUT: RequestHandler = (event) => api(async () => renameAccount(idParam(event), await readJson(event.request)));

/** 409 while any invoice line or expense references the account. */
export const DELETE: RequestHandler = (event) =>
  api(() => {
    deleteAccount(idParam(event));
    return { ok: true };
  });
