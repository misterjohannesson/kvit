import { json, type RequestEvent } from '@sveltejs/kit';
import { HttpError } from './errors';
import { z } from 'zod';

/** Map a service error to a JSON response with the right status. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) return json({ error: e.issues.map((i) => i.message).join('; ') }, { status: 400 });
  console.error(e);
  return json({ error: 'Der opstod en fejl' }, { status: 500 });
}

/** Run a service call in an API handler; errors become JSON with status codes. */
export async function api(fn: () => unknown | Promise<unknown>, status = 200): Promise<Response> {
  try {
    const result = await fn();
    if (result instanceof Response) return result;
    return json(result ?? { ok: true }, { status });
  } catch (e) {
    return errorResponse(e);
  }
}

export function idParam(event: RequestEvent, name = 'id'): number {
  const n = Number((event.params as Record<string, string | undefined>)[name]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Ugyldigt id');
  return n;
}

/** Route param id for page loads/actions: 404 (not 400) when it is not a positive integer. */
export function routeId(params: { id?: string }): number {
  const n = Number(params.id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Ikke fundet');
  return n;
}

/** SvelteKit's redirect()/error() throw plain objects; let them pass through catch blocks. */
export function isRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'status' in e && ('location' in e || 'body' in e);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Ugyldig JSON');
  }
}

/** Human-readable message for form actions. */
export function errorMessage(e: unknown): { status: number; message: string } {
  if (e instanceof HttpError) return { status: e.status, message: e.message };
  console.error(e);
  return { status: 500, message: 'Der opstod en fejl' };
}
