import type { RequestHandler } from './$types';
import { api, expectedNumberFrom, idParam, readOptionalJson } from '$lib/server/api';
import { creditInvoice } from '$lib/server/services/invoices';

/** Body (optional): { expectedNumber } — the credit-note number the user confirmed; 409 if the series moved. */
export const POST: RequestHandler = (event) =>
  api(async () => {
    const body = await readOptionalJson(event.request);
    return creditInvoice(idParam(event), expectedNumberFrom(body.expectedNumber));
  }, 201);
