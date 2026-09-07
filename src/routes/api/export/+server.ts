import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { exportFileName, exportZipStream } from '$lib/server/services/export';

/** The "hand the auditor everything" zip: four CSVs + every file under /data/files/. */
export const GET: RequestHandler = () => {
  const stream = exportZipStream();
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFileName()}"`
    }
  });
};
