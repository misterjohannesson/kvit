import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTheme, THEME_COOKIE } from '$lib/theme';

/** Per-browser colour theme (style.md §9). Stored in a cookie, like the table density. */
export const POST: RequestHandler = async ({ request, cookies }) => {
  const form = await request.formData();
  const value = parseTheme(String(form.get('value') ?? ''));
  cookies.set(THEME_COOKIE, value, { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 60 * 60 * 24 * 365 });
  const back = String(form.get('back') ?? '/');
  redirect(303, back.startsWith('/') && !back.startsWith('//') ? back : '/');
};
