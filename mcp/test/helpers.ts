import { expect, inject } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

export interface ToolResult<T = Record<string, unknown>> {
  isError: boolean;
  data: T;
}

/** A real MCP client wired to a real server over an in-memory transport: tool calls go through the protocol. */
export async function connect(token: string | null = inject('token')): Promise<{ client: Client; call: <T = Record<string, unknown>>(name: string, args?: Record<string, unknown>) => Promise<ToolResult<T>>; close: () => Promise<void> }> {
  const server = createServer({ baseUrl: inject('baseUrl'), token });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'kvit-mcp-tests', version: '1.0.0' });
  await client.connect(clientTransport);
  const call = async <T,>(name: string, args: Record<string, unknown> = {}): Promise<ToolResult<T>> => {
    const r = await client.callTool({ name, arguments: args });
    const content = r.content as { type: string; text?: string }[];
    const text = content.find((c) => c.type === 'text')?.text ?? '';
    // Input-schema violations are rejected by the SDK before the handler runs; they arrive as plain text.
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = { error: 'Invalid arguments', message: text } as unknown as T;
    }
    return { isError: !!r.isError, data };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}

/** Direct app API access (bearer) to verify what the tools did. */
export async function appGet<T>(path: string): Promise<T> {
  const r = await fetch(inject('baseUrl') + path, { headers: { authorization: `Bearer ${inject('token')}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

export interface AuditRow {
  id: number;
  entity: string;
  entityId: number;
  action: string;
  actor: 'ui' | 'api';
  detail: Record<string, unknown>;
}

export const money = (ore: number) => expect.objectContaining({ amount_ore: ore });
