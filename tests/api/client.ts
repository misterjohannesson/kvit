import { inject } from 'vitest';

export class Client {
  base = inject('baseUrl');
  cookie = '';

  async login(password = inject('password')): Promise<Response> {
    const r = await fetch(this.base + '/login', {
      method: 'POST',
      body: new URLSearchParams({ password }),
      redirect: 'manual',
      headers: { accept: 'text/html', origin: this.base }
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    return r;
  }

  async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const init: RequestInit = { method, headers: { cookie: this.cookie, ...headers }, redirect: 'manual' };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
    }
    return fetch(this.base + path, init);
  }

  async json<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const r = await this.raw(method, path, body);
    const text = await r.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: r.status, data: data as T };
  }
}

export async function loggedIn(): Promise<Client> {
  const c = new Client();
  await c.login();
  return c;
}
