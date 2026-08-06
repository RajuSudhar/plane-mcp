import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi } from '@types';
import type { Label, ToolResult } from '@types';
import { toolHandler } from './register';

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color must be a #RRGGBB hex string');

const listLabelsSchema = z.object({
  project_id: z.string(),
});
type ListLabelsArgs = z.infer<typeof listLabelsSchema>;

export const createLabelSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  color: hexColor,
  parent: z.string().nullable().optional(),
});
type CreateLabelArgs = z.infer<typeof createLabelSchema>;

export async function listLabels(client: PlaneApi, args: ListLabelsArgs): Promise<ToolResult> {
  const data = await client.get<Label[]>(
    client.workspacePath(`projects/${args.project_id}/labels/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { labels: data },
  };
}

export async function createLabel(client: PlaneApi, args: CreateLabelArgs): Promise<ToolResult> {
  const { project_id, name, color, parent } = args;
  const body = {
    name,
    color,
    ...(parent !== undefined ? { parent } : {}),
  };
  const label = await client.post<Label>(
    client.workspacePath(`projects/${project_id}/labels/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(label) }],
    structuredContent: label,
  };
}

export function registerLabelTools(server: McpServer, client: PlaneApi): void {
  server.registerTool(
    'list_labels',
    {
      description: 'List all labels for a project.',
      inputSchema: listLabelsSchema,
    },
    toolHandler('list_labels', client, listLabels)
  );

  server.registerTool(
    'create_label',
    {
      description: 'Create a new label for a project.',
      inputSchema: createLabelSchema,
    },
    toolHandler('create_label', client, createLabel)
  );
}
