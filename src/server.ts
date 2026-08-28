import { McpServer } from '@modelcontextprotocol/server';
import type { AuthContext, ServerConfig } from '@types';
import { PlaneClient } from './plane/client';
import { registerUserTools } from './tools/users';
import { registerProjectTools } from './tools/projects';
import { registerWorkItemTools } from './tools/work-items';
import { registerCommentTools } from './tools/comments';
import { registerRelationTools } from './tools/relations';
import { registerStateTools } from './tools/states';
import { registerLabelTools } from './tools/labels';
import { registerMemberTools } from './tools/members';
import { registerCycleTools } from './tools/cycles';
import { registerModuleTools } from './tools/modules';

export function createServer(auth: AuthContext, config: ServerConfig): McpServer {
  const server = new McpServer({
    name: 'plane-mcp',
    version: '0.1.0',
  });

  const client = new PlaneClient(auth);

  registerUserTools(server, client, config);
  registerProjectTools(server, client, config);
  registerWorkItemTools(server, client, config);
  registerCommentTools(server, client, config);
  registerRelationTools(server, client, config);
  registerStateTools(server, client, config);
  registerLabelTools(server, client, config);
  registerMemberTools(server, client, config);
  registerCycleTools(server, client, config);
  registerModuleTools(server, client, config);

  return server;
}
