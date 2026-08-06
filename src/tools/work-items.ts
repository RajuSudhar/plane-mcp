import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi } from '@types';
import type { PaginationEnvelope, WorkItem, ToolResult } from '@types';
import { toolHandler } from './register';
import { toWorkItemWriteBody } from '../plane/normalize';

const priority = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
const stateGroup = z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']);

const listWorkItemsSchema = z.object({
  project_id: z.string(),
  query: z.string().optional(),
  assignee_ids: z.array(z.string()).optional(),
  state_ids: z.array(z.string()).optional(),
  state_groups: z.array(stateGroup).optional(),
  priorities: z.array(priority).optional(),
  label_ids: z.array(z.string()).optional(),
  cycle_ids: z.array(z.string()).optional(),
  module_ids: z.array(z.string()).optional(),
  cursor: z.string().optional(),
  per_page: z.number().int().min(1).max(100).optional(),
  fields: z.string().optional(),
  expand: z.string().optional(),
});
type ListWorkItemsArgs = z.infer<typeof listWorkItemsSchema>;

const retrieveWorkItemSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  fields: z.string().optional(),
  expand: z.string().optional(),
});
type RetrieveWorkItemArgs = z.infer<typeof retrieveWorkItemSchema>;

const retrieveWorkItemByIdentifierSchema = z.object({
  project_id: z.string(),
  project_identifier: z.string(),
  work_item_identifier: z.string(),
});
type RetrieveWorkItemByIdentifierArgs = z.infer<typeof retrieveWorkItemByIdentifierSchema>;

const createWorkItemSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  description_html: z.string().optional(),
  priority: priority.optional(),
  state_id: z.string().optional(),
  assignee_ids: z.array(z.string()).optional(),
  label_ids: z.array(z.string()).optional(),
  type_id: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  estimate_point: z.string().optional(),
  external_id: z.string().optional(),
  external_source: z.string().optional(),
});
type CreateWorkItemArgs = z.infer<typeof createWorkItemSchema>;

const updateWorkItemSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  name: z.string().optional(),
  description_html: z.string().optional(),
  priority: priority.optional(),
  state_id: z.string().optional(),
  assignee_ids: z.array(z.string()).optional(),
  label_ids: z.array(z.string()).optional(),
  type_id: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  estimate_point: z.string().optional(),
  external_id: z.string().optional(),
  external_source: z.string().optional(),
});
type UpdateWorkItemArgs = z.infer<typeof updateWorkItemSchema>;

const deleteWorkItemSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
});
type DeleteWorkItemArgs = z.infer<typeof deleteWorkItemSchema>;

const searchWorkItemsSchema = z.object({
  project_id: z.string(),
  query: z.string(),
});
type SearchWorkItemsArgs = z.infer<typeof searchWorkItemsSchema>;

export async function listWorkItems(
  client: PlaneApi,
  args: ListWorkItemsArgs
): Promise<ToolResult> {
  const data = await client.get<PaginationEnvelope<WorkItem>>(
    client.workspacePath(`projects/${args.project_id}/work-items/`),
    {
      query: args.query as string | number | boolean | undefined,
      assignee_ids: args.assignee_ids?.join(',') as string | number | boolean | undefined,
      state_ids: args.state_ids?.join(',') as string | number | boolean | undefined,
      state_groups: args.state_groups?.join(',') as string | number | boolean | undefined,
      priorities: args.priorities?.join(',') as string | number | boolean | undefined,
      label_ids: args.label_ids?.join(',') as string | number | boolean | undefined,
      cycle_ids: args.cycle_ids?.join(',') as string | number | boolean | undefined,
      module_ids: args.module_ids?.join(',') as string | number | boolean | undefined,
      cursor: args.cursor as string | number | boolean | undefined,
      per_page: args.per_page as string | number | boolean | undefined,
      fields: args.fields as string | number | boolean | undefined,
      expand: args.expand as string | number | boolean | undefined,
    }
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export async function retrieveWorkItem(
  client: PlaneApi,
  args: RetrieveWorkItemArgs
): Promise<ToolResult> {
  const { project_id, work_item_id, ...query } = args;
  const workItem = await client.get<WorkItem>(
    client.workspacePath(`projects/${project_id}/work-items/${work_item_id}/`),
    query
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(workItem) }],
    structuredContent: workItem,
  };
}

export async function retrieveWorkItemByIdentifier(
  client: PlaneApi,
  args: RetrieveWorkItemByIdentifierArgs
): Promise<ToolResult> {
  const path = client.workspacePath(
    `projects/${args.project_id}/work-items/identifier/${args.project_identifier}-${args.work_item_identifier}/`
  );
  const workItem = await client.get<WorkItem>(path);
  return {
    content: [{ type: 'text', text: JSON.stringify(workItem) }],
    structuredContent: workItem,
  };
}

export async function createWorkItem(
  client: PlaneApi,
  args: CreateWorkItemArgs
): Promise<ToolResult> {
  const { project_id, ...rest } = args;
  const body = toWorkItemWriteBody({
    name: rest.name,
    descriptionHtml: rest.description_html,
    priority: rest.priority,
    stateId: rest.state_id,
    assigneeIds: rest.assignee_ids,
    labelIds: rest.label_ids,
    typeId: rest.type_id,
    parentId: rest.parent_id,
    startDate: rest.start_date,
    dueDate: rest.due_date,
    estimatePoint: rest.estimate_point,
    externalId: rest.external_id,
    externalSource: rest.external_source,
  });
  const workItem = await client.post<WorkItem>(
    client.workspacePath(`projects/${project_id}/work-items/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(workItem) }],
    structuredContent: workItem,
  };
}

export async function updateWorkItem(
  client: PlaneApi,
  args: UpdateWorkItemArgs
): Promise<ToolResult> {
  const { project_id, work_item_id, ...rest } = args;
  const body = toWorkItemWriteBody({
    name: rest.name,
    descriptionHtml: rest.description_html,
    priority: rest.priority,
    stateId: rest.state_id,
    assigneeIds: rest.assignee_ids,
    labelIds: rest.label_ids,
    typeId: rest.type_id,
    parentId: rest.parent_id,
    startDate: rest.start_date,
    dueDate: rest.due_date,
    estimatePoint: rest.estimate_point,
    externalId: rest.external_id,
    externalSource: rest.external_source,
  });
  const workItem = await client.patch<WorkItem>(
    client.workspacePath(`projects/${project_id}/work-items/${work_item_id}/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(workItem) }],
    structuredContent: workItem,
  };
}

export async function deleteWorkItem(
  client: PlaneApi,
  args: DeleteWorkItemArgs
): Promise<ToolResult> {
  const { project_id, work_item_id } = args;
  await client.delete(client.workspacePath(`projects/${project_id}/work-items/${work_item_id}/`));
  return {
    content: [{ type: 'text', text: 'Work item deleted' }],
    structuredContent: { deleted: true },
  };
}

export async function searchWorkItems(
  client: PlaneApi,
  args: SearchWorkItemsArgs
): Promise<ToolResult> {
  const { project_id, query } = args;
  const data = await client.get<PaginationEnvelope<WorkItem>>(
    client.workspacePath(`projects/${project_id}/work-items/search/`),
    { q: query as string | number | boolean | undefined }
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function registerWorkItemTools(server: McpServer, client: PlaneApi): void {
  server.registerTool(
    'list_work_items',
    {
      description:
        'List work items in a project with optional filtering by assignee, state, priority, labels, cycles, and modules.',
      inputSchema: listWorkItemsSchema,
    },
    toolHandler('list_work_items', client, listWorkItems)
  );

  server.registerTool(
    'retrieve_work_item',
    {
      description: 'Retrieve a single work item by its UUID.',
      inputSchema: retrieveWorkItemSchema,
    },
    toolHandler('retrieve_work_item', client, retrieveWorkItem)
  );

  server.registerTool(
    'retrieve_work_item_by_identifier',
    {
      description:
        'Retrieve a work item by its human-readable identifier (project_identifier-work_item_identifier).',
      inputSchema: retrieveWorkItemByIdentifierSchema,
    },
    toolHandler('retrieve_work_item_by_identifier', client, retrieveWorkItemByIdentifier)
  );

  server.registerTool(
    'create_work_item',
    {
      description: 'Create a new work item in a project.',
      inputSchema: createWorkItemSchema,
    },
    toolHandler('create_work_item', client, createWorkItem)
  );

  server.registerTool(
    'update_work_item',
    {
      description: 'Update an existing work item.',
      inputSchema: updateWorkItemSchema,
    },
    toolHandler('update_work_item', client, updateWorkItem)
  );

  server.registerTool(
    'delete_work_item',
    {
      description: 'Delete a work item.',
      inputSchema: deleteWorkItemSchema,
    },
    toolHandler('delete_work_item', client, deleteWorkItem)
  );

  server.registerTool(
    'search_work_items',
    {
      description: 'Search for work items in a project by query string.',
      inputSchema: searchWorkItemsSchema,
    },
    toolHandler('search_work_items', client, searchWorkItems)
  );
}
