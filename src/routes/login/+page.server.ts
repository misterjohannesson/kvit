import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { checkPassword, issueSessionToken, SESSION_COOKIE } from '$lib/server/auth';

/** Brute-force brake: after 5 failures from one address, wait 30 s per further attempt. */
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 30_000;

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    let ip = 'unknown';
    try {
      ip = getClientAddress();
    } catch {
      /* no address available */
    }
    const state = failures.get(ip);
    if (state && state.count >= MAX_FAILURES && Date.now() < state.until) {
      return fail(429, { error: 'For mange forsøg. Vent 30 sekunder.' });
    }

    const form = await request.formData();
    const password = String(form.get('password') ?? '');
    if (!checkPassword(password)) {
      const next = { count: (state?.count ?? 0) + 1, until: Date.now() + LOCK_MS };
      failures.set(ip, next);
      return fail(401, { error: 'Forkert kodeord' });
    }
    failures.delete(ip);
    cookies.set(SESSION_COOKIE, issueSessionToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // plain HTTP on a private network (Tailscale); no TLS termination in front
      maxAge: 60 * 60 * 24 * 30
    });
    redirect(303, '/');
  }
};
