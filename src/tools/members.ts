import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi, ServerConfig } from '@types';
import type { Member, ToolResult } from '@types';
import { toolHandler } from './register';

const getProjectMembersSchema = z.object({
  project_id: z.string(),
});
type GetProjectMembersArgs = z.infer<typeof getProjectMembersSchema>;

const getWorkspaceMembersSchema = z.object({});
type GetWorkspaceMembersArgs = z.infer<typeof getWorkspaceMembersSchema>;

export async function getProjectMembers(
  client: PlaneApi,
  args: GetProjectMembersArgs
): Promise<ToolResult> {
  const data = await client.get<Member[]>(
    client.workspacePath(`projects/${args.project_id}/members/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { members: data },
  };
}

export async function getWorkspaceMembers(
  client: PlaneApi,
  _args: GetWorkspaceMembersArgs
): Promise<ToolResult> {
  const data = await client.get<Member[]>(client.workspacePath('members/'));
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { members: data },
  };
}

export function registerMemberTools(
  server: McpServer,
  client: PlaneApi,
  config: ServerConfig
): void {
  server.registerTool(
    'get_project_members',
    {
      description: 'Get all members of a project.',
      inputSchema: getProjectMembersSchema,
    },
    toolHandler('get_project_members', client, getProjectMembers, config)
  );

  server.registerTool(
    'get_workspace_members',
    {
      description: 'Get all members of the workspace.',
      inputSchema: getWorkspaceMembersSchema,
    },
    toolHandler('get_workspace_members', client, getWorkspaceMembers, config)
  );
}
