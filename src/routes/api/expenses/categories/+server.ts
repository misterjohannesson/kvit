import type { RequestHandler } from './$types';
import { api } from '$lib/server/api';
import { listCategories } from '$lib/server/services/expenses';

export const GET: RequestHandler = () => api(() => listCategories());
