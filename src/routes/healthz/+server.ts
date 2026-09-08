import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sqlite } from '$lib/server/db';

/**
 * Liveness for Docker, the installer and reverse proxies. Public (no login),
 * reveals nothing beyond "up": a trivial query proves the database opens.
 */
export const GET: RequestHandler = () => {
  try {
    sqlite.prepare('SELECT 1').get();
    return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return json({ ok: false }, { status: 503 });
  }
};
