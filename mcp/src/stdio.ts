#!/usr/bin/env node
/**
 * stdio transport for local clients (Claude Code, Claude Desktop, MCP Inspector).
 * Env: FAKTURA_URL (default http://127.0.0.1:3000), FAKTURA_API_TOKEN.
 * Nothing is written to stdout except protocol messages; logs go to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { loadConfig } from './config.js';

const config = loadConfig();
if (!config.token) console.error('[kvit-mcp] FAKTURA_API_TOKEN is not set: every tool will fail with an auth error until it is.');
const server = createServer(config);
await server.connect(new StdioServerTransport());
console.error(`[kvit-mcp] stdio ready, app at ${config.baseUrl}`);
