import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { Module, ToolResult } from '@types';
import { toolHandler } from './register';

const listModulesSchema = z.object({
  project_id: z.string(),
});
type ListModulesArgs = z.infer<typeof listModulesSchema>;

export const createModuleSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  lead: z.string().optional(),
  members: z.array(z.string()).optional(),
});
type CreateModuleArgs = z.infer<typeof createModuleSchema>;

export const addWorkItemsToModuleSchema = z.object({
  project_id: z.string(),
  module_id: z.string(),
  work_item_ids: z.array(z.string()).min(1),
});
type AddWorkItemsToModuleArgs = z.infer<typeof addWorkItemsToModuleSchema>;

const removeWorkItemFromModuleSchema = z.object({
  project_id: z.string(),
  module_id: z.string(),
  work_item_id: z.string(),
});
type RemoveWorkItemFromModuleArgs = z.infer<typeof removeWorkItemFromModuleSchema>;

export async function listModules(client: PlaneClient, args: ListModulesArgs): Promise<ToolResult> {
  const data = await client.get<Module[]>(
    client.workspacePath(`projects/${args.project_id}/modules/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { modules: data } as Record<string, unknown>,
  };
}

export async function createModule(
  client: PlaneClient,
  args: CreateModuleArgs
): Promise<ToolResult> {
  const { project_id, name, description, start_date, target_date, lead, members } = args;
  const body = {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(start_date !== undefined ? { start_date } : {}),
    ...(target_date !== undefined ? { target_date } : {}),
    ...(lead !== undefined ? { lead } : {}),
    ...(members !== undefined ? { members } : {}),
  };
  const module = await client.post<Module>(
    client.workspacePath(`projects/${project_id}/modules/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(module) }],
    structuredContent: module as Record<string, unknown>,
  };
}

export async function addWorkItemsToModule(
  client: PlaneClient,
  args: AddWorkItemsToModuleArgs
): Promise<ToolResult> {
  const { project_id, module_id, work_item_ids } = args;
  const body = { work_item_ids };
  const result = await client.post<unknown>(
    client.workspacePath(`projects/${project_id}/modules/${module_id}/work-items/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: (result ?? {}) as Record<string, unknown>,
  };
}

export async function removeWorkItemFromModule(
  client: PlaneClient,
  args: RemoveWorkItemFromModuleArgs
): Promise<ToolResult> {
  const { project_id, module_id, work_item_id } = args;
  await client.delete(
    client.workspacePath(`projects/${project_id}/modules/${module_id}/work-items/${work_item_id}/`)
  );
  return {
    content: [{ type: 'text', text: 'Work item removed from module' }],
    structuredContent: { removed: true } as Record<string, unknown>,
  };
}

export function registerModuleTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_modules',
    {
      description: 'List all modules for a project.',
      inputSchema: listModulesSchema,
    },
    toolHandler('list_modules', client, listModules)
  );

  server.registerTool(
    'create_module',
    {
      description: 'Create a new module for a project.',
      inputSchema: createModuleSchema,
    },
    toolHandler('create_module', client, createModule)
  );

  server.registerTool(
    'add_work_items_to_module',
    {
      description: 'Add work items to a module.',
      inputSchema: addWorkItemsToModuleSchema,
    },
    toolHandler('add_work_items_to_module', client, addWorkItemsToModule)
  );

  server.registerTool(
    'remove_work_item_from_module',
    {
      description: 'Remove a work item from a module.',
      inputSchema: removeWorkItemFromModuleSchema,
    },
    toolHandler('remove_work_item_from_module', client, removeWorkItemFromModule)
  );
}
