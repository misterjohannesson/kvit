import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';
import { HttpError } from '$lib/server/errors';
import { describeImport, importKontoplan, kontoplanCsv, KONTOPLAN_FILE_NAME, KONTOPLAN_MAX_BYTES } from '$lib/server/services/accounts-csv';

/** The kontoplan as `kontonr;navn;type;gruppe;arkiveret` for editing in a spreadsheet. */
export const GET: RequestHandler = () =>
  new Response(kontoplanCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${KONTOPLAN_FILE_NAME}"`,
      'Cache-Control': 'no-store'
    }
  });

/**
 * Upload the edited file: the body is the CSV text (text/csv) or a multipart form with a `file` field.
 * `?prune=1` deletes accounts missing from the file when nothing references them. Atomic: 400/409 leaves the
 * kontoplan untouched.
 */
export const POST: RequestHandler = ({ request, url }) =>
  api(async () => {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > KONTOPLAN_MAX_BYTES * 2) throw new HttpError(413, 'Filen er for stor til at være en kontoplan (maks. 256 KB)');
    const text = await readCsvBody(request);
    const prune = ['1', 'true', 'ja'].includes((url.searchParams.get('prune') ?? '').toLowerCase());
    const result = importKontoplan(text, { prune });
    return { ...result, message: describeImport(result) };
  });

async function readCsvBody(request: Request): Promise<string> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'Vælg en CSV-fil');
    return Buffer.from(await file.arrayBuffer()).toString('utf8');
  }
  const text = await request.text();
  if (!text.trim()) throw new HttpError(400, 'Send CSV-teksten som body (text/csv) eller en fil i feltet "file"');
  return text;
}
