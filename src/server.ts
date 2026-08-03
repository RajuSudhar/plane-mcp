import { McpServer } from '@modelcontextprotocol/server';
import type { AuthContext } from '@types';
import { PlaneClient } from './plane/client';
import { registerUserTools } from './tools/users';
import { registerProjectTools } from './tools/projects';

export function createServer(auth: AuthContext): McpServer {
  const server = new McpServer({
    name: 'plane-mcp',
    version: '0.1.0',
  });

  const client = new PlaneClient(auth);

  registerUserTools(server, client);
  registerProjectTools(server, client);

  return server;
}
