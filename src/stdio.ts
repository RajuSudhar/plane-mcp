#!/usr/bin/env bun

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server';
import { loadAuthContext } from './config';
import { log } from './logger';

const auth = loadAuthContext();
const server = createServer(auth);
const transport = new StdioServerTransport();

log('info', 'plane-mcp stdio server starting', { operation: 'server_init', transport: 'stdio' });

await server.connect(transport);
