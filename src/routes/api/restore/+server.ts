import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';
import { HttpError } from '$lib/server/errors';
import { RESTORE_MAX_BYTES, stageRestore } from '$lib/server/services/restore';

/**
 * Step 1 of a restore: upload an export zip (multipart field `file`, or the zip as the raw body). The zip is
 * validated and kept for two hours; the response carries the id and the summary to confirm with
 * POST /api/restore/{id}. Nothing changes yet.
 */
export const POST: RequestHandler = ({ request }) =>
  api(async () => {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > RESTORE_MAX_BYTES) throw new HttpError(413, 'Zippen er større end 512 MB');
    const contentType = request.headers.get('content-type') ?? '';
    let bytes: Buffer;
    let name = 'eksport.zip';
    if (contentType.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'Vælg en eksport-zip');
      bytes = Buffer.from(await file.arrayBuffer());
      name = file.name || name;
    } else {
      bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length) throw new HttpError(400, 'Send zippen som body eller som multipart-feltet "file"');
    }
    return stageRestore(bytes, name);
  }, 201);
