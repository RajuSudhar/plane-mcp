#!/usr/bin/env bun

import { createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { createServer } from './server';
import { loadAuthContext, loadPort } from './config';
import { log } from './logger';

const auth = loadAuthContext();
const port = loadPort();

const app = createMcpHonoApp();
const mcpHandler = createMcpHandler((_ctx) => createServer(auth), {
  legacy: 'stateless',
});

app.get('/health', (c) => c.json({ status: 'ok' }));

app.all('/mcp', async (c) => {
  try {
    return await mcpHandler.fetch(c.req.raw);
  } catch (err) {
    log('error', 'MCP request failed', {
      operation: 'mcp_request',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

log('info', 'plane-mcp server starting', { operation: 'server_init', port });

export default {
  port,
  hostname: '127.0.0.1',
  fetch: app.fetch,
};
