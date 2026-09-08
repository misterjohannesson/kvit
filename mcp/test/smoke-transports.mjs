/**
 * Manual smoke check of the two real transports (not part of vitest):
 *   node test/smoke-transports.mjs
 * Spawns dist/stdio.js over stdio and dist/http.js over streamable HTTP, lists the
 * tools through each, and prints the count. Needs `npm run build` first; the app
 * itself does not need to be running for tools/list.
 */
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const env = { ...process.env, FAKTURA_URL: 'http://127.0.0.1:3000', FAKTURA_API_TOKEN: 'smoke' };

// stdio
{
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/stdio.js'], env }));
  const { tools } = await client.listTools();
  console.log(`stdio: ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
  await client.close();
}

// streamable HTTP
{
  const port = 3900 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, ['dist/http.js'], { env: { ...env, MCP_PORT: String(port), MCP_HOST: '127.0.0.1' }, stdio: ['ignore', 'inherit', 'inherit'] });
  const url = `http://127.0.0.1:${port}/mcp`;
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/healthz`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const { tools } = await client.listTools();
  console.log(`http: ${tools.length} tools via ${url}`);
  const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  console.log('healthz:', JSON.stringify(health));
  await client.close();
  child.kill();
}
