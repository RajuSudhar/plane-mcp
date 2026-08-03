import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { PaginationEnvelope, Project, ToolResult } from '@types';
import { toolHandler } from './register';

const listProjectsSchema = z.object({
  cursor: z.string().optional(),
  per_page: z.number().int().min(1).max(100).optional(),
  fields: z.string().optional(),
  expand: z.string().optional(),
});
type ListProjectsArgs = z.infer<typeof listProjectsSchema>;

const retrieveProjectSchema = z.object({
  project_id: z.string(),
  fields: z.string().optional(),
  expand: z.string().optional(),
});
type RetrieveProjectArgs = z.infer<typeof retrieveProjectSchema>;

export async function listProjects(
  client: PlaneClient,
  args: ListProjectsArgs
): Promise<ToolResult> {
  const data = await client.get<PaginationEnvelope<Project>>(client.workspacePath('projects/'), {
    cursor: args.cursor as string | number | boolean | undefined,
    per_page: args.per_page as string | number | boolean | undefined,
    fields: args.fields as string | number | boolean | undefined,
    expand: args.expand as string | number | boolean | undefined,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export async function retrieveProject(
  client: PlaneClient,
  args: RetrieveProjectArgs
): Promise<ToolResult> {
  const { project_id, ...query } = args;
  const project = await client.get<Project>(
    client.workspacePath(`projects/${project_id}/`),
    query as Record<string, string | number | boolean | undefined>
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(project) }],
    structuredContent: project as Record<string, unknown>,
  };
}

export function registerProjectTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_projects',
    {
      description:
        'List projects in the configured workspace. Returns the raw pagination envelope.',
      inputSchema: listProjectsSchema,
    },
    toolHandler('list_projects', client, listProjects)
  );

  server.registerTool(
    'retrieve_project',
    { description: 'Retrieve a single project by UUID.', inputSchema: retrieveProjectSchema },
    toolHandler('retrieve_project', client, retrieveProject)
  );
}
