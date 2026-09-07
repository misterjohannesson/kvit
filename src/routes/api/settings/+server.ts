import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { getSettings, updateSettings } from '$lib/server/services/settings';

export const GET: RequestHandler = () => api(() => getSettings());

export const PUT: RequestHandler = ({ request }) => api(async () => updateSettings(await readJson(request)));
