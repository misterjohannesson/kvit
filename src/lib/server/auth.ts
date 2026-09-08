import { createHmac, timingSafeEqual } from 'node:crypto';
import { apiToken, appPassword } from './env';

/**
 * `Authorization: Bearer <API_TOKEN>` for the JSON API. Returns 'valid' when the
 * token matches, 'invalid' when a bearer header is present but wrong or bearer
 * auth is disabled, and 'absent' when there is no bearer header at all.
 */
export function checkBearer(header: string | null): 'valid' | 'invalid' | 'absent' {
  if (!header) return 'absent';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return 'absent';
  const expected = apiToken();
  if (!expected) return 'invalid';
  return safeEqual(m[1].trim(), expected) ? 'valid' : 'invalid';
}

export const SESSION_COOKIE = 'faktura_session';

function sessionToken(): string {
  return createHmac('sha256', appPassword()).update('faktura-session-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string): boolean {
  return safeEqual(candidate, appPassword());
}

export function issueSessionToken(): string {
  return sessionToken();
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  return safeEqual(token, sessionToken());
}
