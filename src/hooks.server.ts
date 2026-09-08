import type { Handle, HandleServerError } from '@sveltejs/kit';
import { json, redirect } from '@sveltejs/kit';
import { assertDesignAssets } from '$lib/server/assets';
import { checkBearer, isValidSession, SESSION_COOKIE } from '$lib/server/auth';
import { appPassword, assertApiTokenStrength } from '$lib/server/env';
import { runWithActor, type Actor } from '$lib/server/audit';
import { sqlite } from '$lib/server/db';
import { closeBrowser } from '$lib/server/pdf';
import { repairArchivedPdfs } from '$lib/server/services/invoices';

// Halt at startup if the design authority files or the password are missing.
assertDesignAssets();
appPassword();
assertApiTokenStrength();
{
  const repaired = repairArchivedPdfs();
  if (repaired > 0) console.warn(`Renamed ${repaired} archived PDF(s) left as .tmp by an interrupted issue`);
}

// adapter-node emits this on SIGINT/SIGTERM once in-flight requests are done.
process.on('sveltekit:shutdown', async () => {
  await closeBrowser();
  sqlite.close();
});

const PUBLIC_PATHS = new Set(['/login', '/healthz']);
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
  if (!origin) return false;
  // "null" is what sandboxed iframes and data: pages send; never a legitimate same-site form.
  if (origin === 'null') return true;
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

  // Bearer token (API_TOKEN) on the JSON API: the MCP server's way in. A bearer header is decisive: a
  // wrong or disabled token is 401 even if a session cookie is also present, so a misconfigured client
  // never silently falls back to the browser session. Every write made this way is audited as actor 'api'.
  let actor: Actor = 'ui';
  let authed = false;
  const isApi = event.url.pathname.startsWith('/api/');
  const bearer = isApi ? checkBearer(event.request.headers.get('authorization')) : 'absent';
  if (bearer === 'valid') {
    authed = true;
    actor = 'api';
  } else if (bearer === 'invalid') {
    return json({ error: 'Ugyldigt API-token' }, { status: 401 });
  } else {
    authed = isValidSession(event.cookies.get(SESSION_COOKIE));
  }
  event.locals.authenticated = authed;

  if (!authed && !PUBLIC_PATHS.has(event.url.pathname)) {
    if (isApi) {
      return json({ error: 'Ikke logget ind' }, { status: 401 });
    }
    redirect(303, '/login');
  }
  if (authed && event.url.pathname === '/login' && event.request.method === 'GET') {
    redirect(303, '/');
  }

  const response = await runWithActor(actor, () => resolve(event));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};

export const handleError: HandleServerError = ({ error }) => {
  console.error(error);
  return { message: 'Der opstod en fejl' };
};
