import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, type Config } from './config.js';
import { FakturaClient } from './client.js';
import { registerTools } from './tools.js';

export const SERVER_INFO = { name: 'kvit-mcp', version: '1.0.0' } as const;

/**
 * One server = one FakturaClient over the app's HTTP API. Nothing here touches
 * the database; the app enforces numbering, immutability and audit logging.
 */
export function createServer(config: Config = loadConfig()): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'Kvit (Faktura) bookkeeping for one Danish business, DKK only. Amounts come as integer øre plus a formatted string; dates are ISO. ' +
      'Read tools answer cash, VAT, P&L and invoice questions; write tools only append reversible records (paid dates, cash movements, reconciliations, drafts, expenses). ' +
      'Issuing and crediting invoices is intentionally not possible via MCP: the owner does that in the app UI.'
  });
  registerTools(server, new FakturaClient(config));
  return server;
}
