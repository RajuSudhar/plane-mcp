import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi, ServerConfig } from '@types';
import type { Cycle, ToolResult } from '@types';
import { toolHandler } from './register';

const listCyclesSchema = z.object({
  project_id: z.string(),
});
type ListCyclesArgs = z.infer<typeof listCyclesSchema>;

export const createCycleSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});
type CreateCycleArgs = z.infer<typeof createCycleSchema>;

export const addWorkItemsToCycleSchema = z.object({
  project_id: z.string(),
  cycle_id: z.string(),
  work_item_ids: z.array(z.string()).min(1),
});
type AddWorkItemsToCycleArgs = z.infer<typeof addWorkItemsToCycleSchema>;

const removeWorkItemFromCycleSchema = z.object({
  project_id: z.string(),
  cycle_id: z.string(),
  work_item_id: z.string(),
});
type RemoveWorkItemFromCycleArgs = z.infer<typeof removeWorkItemFromCycleSchema>;

export async function listCycles(client: PlaneApi, args: ListCyclesArgs): Promise<ToolResult> {
  const data = await client.get<Cycle[]>(
    client.workspacePath(`projects/${args.project_id}/cycles/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { cycles: data },
  };
}

export async function createCycle(client: PlaneApi, args: CreateCycleArgs): Promise<ToolResult> {
  const { project_id, name, description, start_date, end_date } = args;
  const body = {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(start_date !== undefined ? { start_date } : {}),
    ...(end_date !== undefined ? { end_date } : {}),
  };
  const cycle = await client.post<Cycle>(
    client.workspacePath(`projects/${project_id}/cycles/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(cycle) }],
    structuredContent: cycle,
  };
}

export async function addWorkItemsToCycle(
  client: PlaneApi,
  args: AddWorkItemsToCycleArgs
): Promise<ToolResult> {
  const { project_id, cycle_id, work_item_ids } = args;
  const body = { issues: work_item_ids };
  const result = await client.post<Record<string, unknown>>(
    client.workspacePath(`projects/${project_id}/cycles/${cycle_id}/cycle-issues/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

export async function removeWorkItemFromCycle(
  client: PlaneApi,
  args: RemoveWorkItemFromCycleArgs
): Promise<ToolResult> {
  const { project_id, cycle_id, work_item_id } = args;
  await client.delete(
    client.workspacePath(`projects/${project_id}/cycles/${cycle_id}/cycle-issues/${work_item_id}/`)
  );
  return {
    content: [{ type: 'text', text: 'Work item removed from cycle' }],
    structuredContent: { removed: true },
  };
}

export function registerCycleTools(
  server: McpServer,
  client: PlaneApi,
  config: ServerConfig
): void {
  server.registerTool(
    'list_cycles',
    {
      description: 'List all cycles for a project.',
      inputSchema: listCyclesSchema,
    },
    toolHandler('list_cycles', client, listCycles, config)
  );

  server.registerTool(
    'create_cycle',
    {
      description: 'Create a new cycle for a project.',
      inputSchema: createCycleSchema,
    },
    toolHandler('create_cycle', client, createCycle, config)
  );

  server.registerTool(
    'add_work_items_to_cycle',
    {
      description:
        'Add work items to a cycle. Work item ids must be UUIDs; resolve human identifiers such as BZ-5777 via retrieve_work_item_by_identifier.',
      inputSchema: addWorkItemsToCycleSchema,
    },
    toolHandler('add_work_items_to_cycle', client, addWorkItemsToCycle, config)
  );

  server.registerTool(
    'remove_work_item_from_cycle',
    {
      description:
        'Remove a work item from a cycle. Work item ids must be UUIDs; resolve human identifiers such as BZ-5777 via retrieve_work_item_by_identifier.',
      inputSchema: removeWorkItemFromCycleSchema,
    },
    toolHandler('remove_work_item_from_cycle', client, removeWorkItemFromCycle, config)
  );
}
