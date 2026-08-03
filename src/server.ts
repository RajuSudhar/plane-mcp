import { McpServer } from '@modelcontextprotocol/server';
import type { AuthContext } from '@types';

export function createServer(_auth: AuthContext): McpServer {
  const server = new McpServer({
    name: 'plane-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'ping',
    {
      description: 'Temporary boot-verification tool. Removed once real tools land in Phase 05.',
      inputSchema: {},
    },
    async (_args: Record<string, unknown>) => ({
      content: [{ type: 'text' as const, text: 'pong' }],
    })
  );

  return server;
}
