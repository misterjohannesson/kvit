import type { RequestHandler } from './$types';
import { api, readOptionalJson } from '$lib/server/api';
import { HttpError } from '$lib/server/errors';
import { applyRestore, discardStaged, getStaged } from '$lib/server/services/restore';

/** The summary of a staged upload. */
export const GET: RequestHandler = ({ params }) => api(() => getStaged(params.id));

/**
 * Step 2: apply the staged upload. The body must carry `{ "confirm": true }`; the current data is copied to
 * backups/data.bakNN/ first, then every table is rebuilt from the zip and files/ is replaced.
 */
export const POST: RequestHandler = ({ params, request }) =>
  api(async () => {
    const body = await readOptionalJson(request);
    if (body.confirm !== true) throw new HttpError(400, 'Bekræft med { "confirm": true }; alle nuværende data erstattes');
    return applyRestore(params.id);
  });

/** Forget a staged upload without applying it. */
export const DELETE: RequestHandler = ({ params }) =>
  api(() => {
    discardStaged(params.id);
    return { ok: true };
  });
