import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi, ServerConfig } from '@types';
import type { Member, ToolResult } from '@types';
import { toolHandler } from './register';

const getProjectMembersSchema = z.object({
  project_id: z.string(),
  fields: z.string().optional(),
  expand: z.string().optional(),
  max_output_tokens: z.number().int().positive().optional(),
});
type GetProjectMembersArgs = z.infer<typeof getProjectMembersSchema>;

const getWorkspaceMembersSchema = z.object({
  fields: z.string().optional(),
  expand: z.string().optional(),
  max_output_tokens: z.number().int().positive().optional(),
});
type GetWorkspaceMembersArgs = z.infer<typeof getWorkspaceMembersSchema>;

export async function getProjectMembers(
  client: PlaneApi,
  args: GetProjectMembersArgs
): Promise<ToolResult> {
  const { project_id, fields, expand } = args;
  const data = await client.get<Member[]>(client.workspacePath(`projects/${project_id}/members/`), {
    fields,
    expand,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { members: data },
  };
}

export async function getWorkspaceMembers(
  client: PlaneApi,
  args: GetWorkspaceMembersArgs
): Promise<ToolResult> {
  const { fields, expand } = args;
  const data = await client.get<Member[]>(client.workspacePath('members/'), {
    fields,
    expand,
  });
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
