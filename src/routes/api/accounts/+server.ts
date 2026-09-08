import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createAccount, listAccounts, listActiveAccounts } from '$lib/server/services/accounts';

/** ?type=revenue|cost filters the kontoplan; ?active=1 leaves out archived accounts. */
export const GET: RequestHandler = ({ url }) =>
  api(() => {
    const t = url.searchParams.get('type');
    const type = t === 'revenue' || t === 'cost' ? t : undefined;
    return url.searchParams.get('active') === '1' ? listActiveAccounts(type) : listAccounts(type);
  });

export const POST: RequestHandler = ({ request }) => api(async () => createAccount(await readJson(request)), 201);
