#!/usr/bin/env bun

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server';
import { loadAuthContext, loadServerConfig } from './config';
import { log } from './logger';
import { runInit } from './init';

const [, , subcommand, ...rest] = process.argv;

if (subcommand === 'init') {
  await runInit(rest);
} else {
  // Default: run stdio server
  const auth = await loadAuthContext();
  const config = await loadServerConfig();
  const server = createServer(auth, config);
  const transport = new StdioServerTransport();

  log('info', 'plane-mcp stdio server starting', { operation: 'server_init', transport: 'stdio' });

  await server.connect(transport);
}
