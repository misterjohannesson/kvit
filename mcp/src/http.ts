/**
 * Streamable HTTP transport, stateless: one server + transport per request.
 * Binds to MCP_HOST (default 127.0.0.1; set the tailnet address to share it on
 * the private network) and MCP_PORT (default 3333); the endpoint is /mcp.
 * Host-header validation (DNS-rebinding protection) is on: only requests
 * addressed to the bound host:port (or MCP_ALLOWED_HOSTS) are served, so a
 * browser page that rebinds a public name to this address cannot drive the
 * write tools. Env: FAKTURA_URL, FAKTURA_API_TOKEN as for stdio.
 */
import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const host = process.env.MCP_HOST ?? '127.0.0.1';
const port = Number(process.env.MCP_PORT ?? 3333);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[kvit-mcp] MCP_PORT must be an integer between 1 and 65535 (got "${process.env.MCP_PORT}")`);
  process.exit(1);
}
if (!config.token) console.error('[kvit-mcp] FAKTURA_API_TOKEN is not set: every tool will fail with an auth error until it is.');

// Hosts a client may address us as: the bound address, localhost spellings, plus MCP_ALLOWED_HOSTS (comma-separated).
const allowedHosts = Array.from(
  new Set(
    [`${host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...(process.env.MCP_ALLOWED_HOSTS ?? '').split(',')]
      .map((h) => h.trim())
      .filter(Boolean)
  )
);

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, token_configured: !!config.token }));
    return;
  }
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. The MCP endpoint is /mcp.' }));
    return;
  }
  try {
    const server = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    console.error('[kvit-mcp] request failed:', e instanceof Error ? e.message : e);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
  }
});

httpServer.listen(port, host, () => {
  console.error(`[kvit-mcp] streamable HTTP on http://${host}:${port}/mcp (allowed hosts: ${allowedHosts.join(', ')}), app at ${config.baseUrl}`);
});
