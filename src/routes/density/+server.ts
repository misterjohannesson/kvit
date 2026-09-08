import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DENSITY_COOKIE = 'faktura_density';

/** Per-user "Kompakt" table density toggle (style.md §3). Stored in a cookie. */
export const POST: RequestHandler = async ({ request, cookies }) => {
  const form = await request.formData();
  const value = form.get('value') === 'dense' ? 'dense' : 'normal';
  cookies.set(DENSITY_COOKIE, value, { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 60 * 60 * 24 * 365 });
  const back = String(form.get('back') ?? '/');
  redirect(303, back.startsWith('/') && !back.startsWith('//') ? back : '/');
};
