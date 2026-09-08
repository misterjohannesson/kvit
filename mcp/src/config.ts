/**
 * Configuration from the environment. The MCP server never opens the app's
 * database; everything goes through FAKTURA_URL with FAKTURA_API_TOKEN as a
 * bearer token. A missing token is reported per tool call as an auth error
 * (the server still starts, so a client can list the tools).
 */
export interface Config {
  baseUrl: string;
  token: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = (env.FAKTURA_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
  let baseUrl: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    baseUrl = u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    throw new Error(`FAKTURA_URL is not a valid http(s) URL: "${raw}"`);
  }
  const token = (env.FAKTURA_API_TOKEN ?? '').trim();
  return { baseUrl, token: token.length > 0 ? token : null };
}
