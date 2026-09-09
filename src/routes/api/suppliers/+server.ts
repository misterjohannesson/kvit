import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createSupplier, listSuppliers } from '$lib/server/services/suppliers';

/** Suppliers with usage: number of expenses, total ex VAT and the last expense date. */
export const GET: RequestHandler = () => api(() => listSuppliers());

/** `{ name }`; 409 when the name exists (ignoring case). The expense endpoints also create suppliers from a name. */
export const POST: RequestHandler = ({ request }) => api(async () => createSupplier(await readJson(request)), 201);
