import { McpServer } from '@modelcontextprotocol/server';
import type { AuthContext } from '@types';
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

export function createServer(auth: AuthContext): McpServer {
  const server = new McpServer({
    name: 'plane-mcp',
    version: '0.1.0',
  });

  const client = new PlaneClient(auth);

  registerUserTools(server, client);
  registerProjectTools(server, client);
  registerWorkItemTools(server, client);
  registerCommentTools(server, client);
  registerRelationTools(server, client);
  registerStateTools(server, client);
  registerLabelTools(server, client);
  registerMemberTools(server, client);
  registerCycleTools(server, client);
  registerModuleTools(server, client);

  return server;
}
