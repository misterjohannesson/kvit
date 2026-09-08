import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createMovement, listMovements } from '$lib/server/services/cash';

export const GET: RequestHandler = ({ url }) =>
  api(() => listMovements({ year: url.searchParams.get('year') ? Number(url.searchParams.get('year')) : undefined }));

/** Body: { date, description, amountOre (signed), kind }. Movements are never edited or deleted. */
export const POST: RequestHandler = ({ request }) => api(async () => createMovement(await readJson(request)), 201);
