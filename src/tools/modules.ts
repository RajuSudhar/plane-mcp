import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi, ServerConfig } from '@types';
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

export async function listModules(client: PlaneApi, args: ListModulesArgs): Promise<ToolResult> {
  const data = await client.get<Module[]>(
    client.workspacePath(`projects/${args.project_id}/modules/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { modules: data },
  };
}

export async function createModule(client: PlaneApi, args: CreateModuleArgs): Promise<ToolResult> {
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
    structuredContent: module,
  };
}

export async function addWorkItemsToModule(
  client: PlaneApi,
  args: AddWorkItemsToModuleArgs
): Promise<ToolResult> {
  const { project_id, module_id, work_item_ids } = args;
  const body = { issues: work_item_ids };
  const result = await client.post<Record<string, unknown>>(
    client.workspacePath(`projects/${project_id}/modules/${module_id}/module-issues/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

export async function removeWorkItemFromModule(
  client: PlaneApi,
  args: RemoveWorkItemFromModuleArgs
): Promise<ToolResult> {
  const { project_id, module_id, work_item_id } = args;
  await client.delete(
    client.workspacePath(
      `projects/${project_id}/modules/${module_id}/module-issues/${work_item_id}/`
    )
  );
  return {
    content: [{ type: 'text', text: 'Work item removed from module' }],
    structuredContent: { removed: true },
  };
}

export function registerModuleTools(
  server: McpServer,
  client: PlaneApi,
  config: ServerConfig
): void {
  server.registerTool(
    'list_modules',
    {
      description: 'List all modules for a project.',
      inputSchema: listModulesSchema,
    },
    toolHandler('list_modules', client, listModules, config)
  );

  server.registerTool(
    'create_module',
    {
      description: 'Create a new module for a project.',
      inputSchema: createModuleSchema,
    },
    toolHandler('create_module', client, createModule, config)
  );

  server.registerTool(
    'add_work_items_to_module',
    {
      description:
        'Add work items to a module. Work item ids must be UUIDs; resolve human identifiers such as BZ-5777 via retrieve_work_item_by_identifier.',
      inputSchema: addWorkItemsToModuleSchema,
    },
    toolHandler('add_work_items_to_module', client, addWorkItemsToModule, config)
  );

  server.registerTool(
    'remove_work_item_from_module',
    {
      description:
        'Remove a work item from a module. Work item ids must be UUIDs; resolve human identifiers such as BZ-5777 via retrieve_work_item_by_identifier.',
      inputSchema: removeWorkItemFromModuleSchema,
    },
    toolHandler('remove_work_item_from_module', client, removeWorkItemFromModule, config)
  );
}
