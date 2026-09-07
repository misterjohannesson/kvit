import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createAccount, listAccounts } from '$lib/server/services/accounts';

/** ?type=revenue|cost filters the kontoplan. */
export const GET: RequestHandler = ({ url }) =>
  api(() => {
    const t = url.searchParams.get('type');
    return listAccounts(t === 'revenue' || t === 'cost' ? t : undefined);
  });

export const POST: RequestHandler = ({ request }) => api(async () => createAccount(await readJson(request)), 201);
