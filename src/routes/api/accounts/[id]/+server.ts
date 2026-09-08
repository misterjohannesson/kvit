import type { RequestHandler } from './$types';
import { api, idParam, readJson } from '$lib/server/api';
import { deleteAccount, getAccount, updateAccount } from '$lib/server/services/accounts';

export const GET: RequestHandler = (event) => api(() => getAccount(idParam(event)));

/** Partial update of name, group and archived; number and type are fixed once created. */
export const PUT: RequestHandler = (event) => api(async () => updateAccount(idParam(event), await readJson(event.request)));

/** 409 while any invoice line or expense references the account, or while it is the last active account of its type. */
export const DELETE: RequestHandler = (event) =>
  api(() => {
    deleteAccount(idParam(event));
    return { ok: true };
  });
