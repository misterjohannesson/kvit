import type { Handle, HandleServerError } from '@sveltejs/kit';
import { json, redirect } from '@sveltejs/kit';
import { assertDesignAssets } from '$lib/server/assets';
import { isValidSession, SESSION_COOKIE } from '$lib/server/auth';
import { appPassword } from '$lib/server/env';
import { sqlite } from '$lib/server/db';
import { closeBrowser } from '$lib/server/pdf';

// Halt at startup if the design authority files or the password are missing.
assertDesignAssets();
appPassword();

// adapter-node emits this on SIGINT/SIGTERM once in-flight requests are done.
process.on('sveltekit:shutdown', async () => {
  await closeBrowser();
  sqlite.close();
});

const PUBLIC_PATHS = new Set(['/login']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF: a browser always sends Origin on cross-site mutations. Since the app is
 * reached by whatever host name the private network uses, SvelteKit's fixed
 * origin list is replaced by a host match: Origin (when present) must point at
 * the host the request arrived on. Requests without Origin (scripts) pass.
 */
function originMismatch(request: Request, url: URL): boolean {
  if (!MUTATING.has(request.method)) return false;
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    return new URL(origin).host !== url.host;
  } catch {
    return true;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  if (originMismatch(event.request, event.url)) {
    return json({ error: 'Cross-site request refused' }, { status: 403 });
  }

  const authed = isValidSession(event.cookies.get(SESSION_COOKIE));
  event.locals.authenticated = authed;

  if (!authed && !PUBLIC_PATHS.has(event.url.pathname)) {
    if (event.url.pathname.startsWith('/api/')) {
      return json({ error: 'Ikke logget ind' }, { status: 401 });
    }
    redirect(303, '/login');
  }
  if (authed && event.url.pathname === '/login' && event.request.method === 'GET') {
    redirect(303, '/');
  }

  const response = await resolve(event);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};

export const handleError: HandleServerError = ({ error }) => {
  console.error(error);
  return { message: 'Der opstod en fejl' };
};
