#!/usr/bin/env bun

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server';
import { loadAuthContext, loadServerConfig } from './config';
import { log } from './logger';
import { runInit } from './init';
import { printHelp } from './help';

export function resolveCommand(argv: string[]): {
  command: 'help' | 'init' | 'server';
  rest: string[];
} {
  const [subcommand, ...rest] = argv;

  if (subcommand === 'help' || argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', rest };
  }
  if (subcommand === 'init') {
    return { command: 'init', rest };
  }
  return { command: 'server', rest: argv };
}

if (import.meta.main) {
  const { command, rest } = resolveCommand(process.argv.slice(2));

  if (command === 'help') {
    printHelp();
  } else if (command === 'init') {
    await runInit(rest);
  } else {
    // Default: run stdio server
    const auth = await loadAuthContext();
    const config = await loadServerConfig();
    const server = createServer(auth, config);
    const transport = new StdioServerTransport();

    log('info', 'plane-mcp stdio server starting', {
      operation: 'server_init',
      transport: 'stdio',
    });

    await server.connect(transport);
  }
}
