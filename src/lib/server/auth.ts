import { createHmac, timingSafeEqual } from 'node:crypto';
import { appPassword } from './env';

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
