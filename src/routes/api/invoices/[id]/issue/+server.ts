import type { RequestHandler } from './$types';
import { api, expectedNumberFrom, idParam, readOptionalJson } from '$lib/server/api';
import { issueInvoice } from '$lib/server/services/invoices';

/** Body (optional): { expectedNumber } — the number the user confirmed; 409 if the series moved. */
export const POST: RequestHandler = (event) =>
  api(async () => {
    const body = await readOptionalJson(event.request);
    return issueInvoice(idParam(event), expectedNumberFrom(body.expectedNumber));
  });
