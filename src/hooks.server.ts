import type { Handle, HandleServerError } from '@sveltejs/kit';
import { json, redirect } from '@sveltejs/kit';
import { assertDesignAssets } from '$lib/server/assets';
import { isValidSession, SESSION_COOKIE } from '$lib/server/auth';
import { appPassword } from '$lib/server/env';
import '$lib/server/db';

// Halt at startup if the design authority files or the password are missing.
assertDesignAssets();
appPassword();

const PUBLIC_PATHS = new Set(['/login']);

export const handle: Handle = async ({ event, resolve }) => {
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
