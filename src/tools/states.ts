import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi, ServerConfig } from '@types';
import type { State, ToolResult } from '@types';
import { toolHandler } from './register';

const stateGroup = z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']);
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color must be a #RRGGBB hex string');

const listStatesSchema = z.object({
  project_id: z.string(),
});
type ListStatesArgs = z.infer<typeof listStatesSchema>;

export const createStateSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  color: hexColor,
  group: stateGroup,
  description: z.string().optional(),
});
type CreateStateArgs = z.infer<typeof createStateSchema>;

export async function listStates(client: PlaneApi, args: ListStatesArgs): Promise<ToolResult> {
  const data = await client.get<State[]>(
    client.workspacePath(`projects/${args.project_id}/states/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { states: data },
  };
}

export async function createState(client: PlaneApi, args: CreateStateArgs): Promise<ToolResult> {
  const { project_id, name, color, group, description } = args;
  const body = {
    name,
    color,
    group,
    ...(description !== undefined ? { description } : {}),
  };
  const state = await client.post<State>(
    client.workspacePath(`projects/${project_id}/states/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(state) }],
    structuredContent: state,
  };
}

export function registerStateTools(
  server: McpServer,
  client: PlaneApi,
  config: ServerConfig
): void {
  server.registerTool(
    'list_states',
    {
      description: 'List all states for a project.',
      inputSchema: listStatesSchema,
    },
    toolHandler('list_states', client, listStates, config)
  );

  server.registerTool(
    'create_state',
    {
      description: 'Create a new state for a project.',
      inputSchema: createStateSchema,
    },
    toolHandler('create_state', client, createState, config)
  );
}
