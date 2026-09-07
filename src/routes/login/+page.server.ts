import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { checkPassword, issueSessionToken, SESSION_COOKIE } from '$lib/server/auth';

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const password = String(form.get('password') ?? '');
    if (!checkPassword(password)) {
      return fail(401, { error: 'Forkert kodeord' });
    }
    cookies.set(SESSION_COOKIE, issueSessionToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 60 * 60 * 24 * 30
    });
    redirect(303, '/');
  }
};
