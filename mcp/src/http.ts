/**
 * Streamable HTTP transport, stateless: one server + transport per request.
 * Binds to MCP_HOST (default 127.0.0.1; set the tailnet address to share it on
 * the private network) and MCP_PORT (default 3333); the endpoint is /mcp.
 * Env: FAKTURA_URL, FAKTURA_API_TOKEN as for stdio.
 */
import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const host = process.env.MCP_HOST ?? '127.0.0.1';
const port = Number(process.env.MCP_PORT ?? 3333);
if (!config.token) console.error('[kvit-mcp] FAKTURA_API_TOKEN is not set: every tool will fail with an auth error until it is.');

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: config.baseUrl, token_configured: !!config.token }));
    return;
  }
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. The MCP endpoint is /mcp.' }));
    return;
  }
  try {
    const server = createServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    console.error('[kvit-mcp] request failed:', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
  }
});

httpServer.listen(port, host, () => {
  console.error(`[kvit-mcp] streamable HTTP on http://${host}:${port}/mcp, app at ${config.baseUrl}`);
});
