import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi, ServerConfig } from '@types';
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

export async function listProjects(client: PlaneApi, args: ListProjectsArgs): Promise<ToolResult> {
  const data = await client.get<PaginationEnvelope<Project>>(client.workspacePath('projects/'), {
    cursor: args.cursor as string | number | boolean | undefined,
    per_page: args.per_page as string | number | boolean | undefined,
    fields: args.fields as string | number | boolean | undefined,
    expand: args.expand as string | number | boolean | undefined,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export async function retrieveProject(
  client: PlaneApi,
  args: RetrieveProjectArgs
): Promise<ToolResult> {
  const { project_id, ...query } = args;
  const project = await client.get<Project>(client.workspacePath(`projects/${project_id}/`), query);
  return {
    content: [{ type: 'text', text: JSON.stringify(project) }],
    structuredContent: project,
  };
}

export function registerProjectTools(
  server: McpServer,
  client: PlaneApi,
  config: ServerConfig
): void {
  server.registerTool(
    'list_projects',
    {
      description:
        'List projects in the configured workspace. Returns the raw pagination envelope.',
      inputSchema: listProjectsSchema,
    },
    toolHandler('list_projects', client, listProjects, config)
  );

  server.registerTool(
    'retrieve_project',
    { description: 'Retrieve a single project by UUID.', inputSchema: retrieveProjectSchema },
    toolHandler('retrieve_project', client, retrieveProject, config)
  );
}
