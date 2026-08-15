import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi } from '@types';
import type { Relation, ToolResult } from '@types';
import { toolHandler } from './register';

const relationTypeEnum = z.enum([
  'blocking',
  'blocked_by',
  'duplicate_of',
  'duplicate',
  'relates_to',
]);

const listWorkItemRelationsSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
});
type ListWorkItemRelationsArgs = z.infer<typeof listWorkItemRelationsSchema>;

export const createWorkItemRelationSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  related_work_item_id: z.string(),
  relation_type: relationTypeEnum,
});
type CreateWorkItemRelationArgs = z.infer<typeof createWorkItemRelationSchema>;

const removeWorkItemRelationSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  relation_id: z.string(),
});
type RemoveWorkItemRelationArgs = z.infer<typeof removeWorkItemRelationSchema>;

export async function listWorkItemRelations(
  client: PlaneApi,
  args: ListWorkItemRelationsArgs
): Promise<ToolResult> {
  const data = await client.get<Relation[]>(
    client.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/relations/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { relations: data },
  };
}

export async function createWorkItemRelation(
  client: PlaneApi,
  args: CreateWorkItemRelationArgs
): Promise<ToolResult> {
  const { project_id, work_item_id, related_work_item_id, relation_type } = args;
  const body = { relation_type, issues: [related_work_item_id] };
  const relation = await client.post<Relation>(
    client.workspacePath(`projects/${project_id}/work-items/${work_item_id}/relations/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(relation) }],
    structuredContent: relation,
  };
}

export async function removeWorkItemRelation(
  client: PlaneApi,
  args: RemoveWorkItemRelationArgs
): Promise<ToolResult> {
  const { project_id, work_item_id, relation_id } = args;
  await client.delete(
    client.workspacePath(
      `projects/${project_id}/work-items/${work_item_id}/relations/${relation_id}/`
    )
  );
  return {
    content: [{ type: 'text', text: 'Relation deleted' }],
    structuredContent: { deleted: true },
  };
}

export function registerRelationTools(server: McpServer, client: PlaneApi): void {
  server.registerTool(
    'list_work_item_relations',
    {
      description: 'List relations for a work item.',
      inputSchema: listWorkItemRelationsSchema,
    },
    toolHandler('list_work_item_relations', client, listWorkItemRelations)
  );

  server.registerTool(
    'create_work_item_relation',
    {
      description: 'Create a relation between work items.',
      inputSchema: createWorkItemRelationSchema,
    },
    toolHandler('create_work_item_relation', client, createWorkItemRelation)
  );

  server.registerTool(
    'remove_work_item_relation',
    {
      description: 'Remove a relation between work items.',
      inputSchema: removeWorkItemRelationSchema,
    },
    toolHandler('remove_work_item_relation', client, removeWorkItemRelation)
  );
}
