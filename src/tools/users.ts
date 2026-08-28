import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi, ServerConfig } from '@types';
import type { ToolResult } from '@types';
import { toolHandler } from './register';

const getMeSchema = z.object({});
type GetMeArgs = z.infer<typeof getMeSchema>;

export async function getMe(client: PlaneApi, _args: GetMeArgs): Promise<ToolResult> {
  const data = await client.get<Record<string, unknown>>(client.apiPath('users/me/'));
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function registerUserTools(server: McpServer, client: PlaneApi, config: ServerConfig): void {
  server.registerTool(
    'get_me',
    { description: "Return the authenticated user's profile.", inputSchema: getMeSchema },
    toolHandler('get_me', client, getMe, config)
  );
}
