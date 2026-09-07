import type { RequestHandler } from './$types';
import { api, readJson } from '$lib/server/api';
import { createCustomer, listCustomers } from '$lib/server/services/customers';

export const GET: RequestHandler = () => api(() => listCustomers());

export const POST: RequestHandler = ({ request }) =>
  api(async () => createCustomer(await readJson(request)), 201);
