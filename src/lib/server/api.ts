import { json, type RequestEvent } from '@sveltejs/kit';
import { HttpError } from './errors';

/** Map a service error to a JSON response with the right status. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message, fields: e.fields }, { status: e.status });
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

/**
 * Optional "the number the user confirmed" from a JSON body or form field.
 * Absent -> undefined (no check); present but not a positive integer -> 400.
 */
export function expectedNumberFrom(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'expectedNumber skal være et positivt heltal');
  return n;
}

/** Keep the user's typed values when re-rendering a failed form. */
export function formValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') values[k] = v;
  return values;
}

/** Human-readable message for form actions. */
export function errorMessage(e: unknown): { status: number; message: string } {
  if (e instanceof HttpError) return { status: e.status, message: e.message };
  console.error(e);
  return { status: 500, message: 'Der opstod en fejl' };
}
