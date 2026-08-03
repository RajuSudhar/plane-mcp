import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { Member, ToolResult } from '@types';
import { toolHandler } from './register';

const getProjectMembersSchema = z.object({
  project_id: z.string(),
});
type GetProjectMembersArgs = z.infer<typeof getProjectMembersSchema>;

const getWorkspaceMembersSchema = z.object({});
type GetWorkspaceMembersArgs = z.infer<typeof getWorkspaceMembersSchema>;

export async function getProjectMembers(
  client: PlaneClient,
  args: GetProjectMembersArgs
): Promise<ToolResult> {
  const data = await client.get<Member[]>(
    client.workspacePath(`projects/${args.project_id}/members/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { members: data } as Record<string, unknown>,
  };
}

export async function getWorkspaceMembers(
  client: PlaneClient,
  _args: GetWorkspaceMembersArgs
): Promise<ToolResult> {
  const data = await client.get<Member[]>(client.workspacePath('members/'));
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { members: data } as Record<string, unknown>,
  };
}

export function registerMemberTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'get_project_members',
    {
      description: 'Get all members of a project.',
      inputSchema: getProjectMembersSchema,
    },
    toolHandler('get_project_members', client, getProjectMembers)
  );

  server.registerTool(
    'get_workspace_members',
    {
      description: 'Get all members of the workspace.',
      inputSchema: getWorkspaceMembersSchema,
    },
    toolHandler('get_workspace_members', client, getWorkspaceMembers)
  );
}
