import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneApi } from '@types';
import type { PaginationEnvelope, Comment, ToolResult } from '@types';
import { toolHandler } from './register';

const listWorkItemCommentsSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
});
type ListWorkItemCommentsArgs = z.infer<typeof listWorkItemCommentsSchema>;

const createWorkItemCommentSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  comment_html: z.string(),
});
type CreateWorkItemCommentArgs = z.infer<typeof createWorkItemCommentSchema>;

const updateWorkItemCommentSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  comment_id: z.string(),
  comment_html: z.string(),
});
type UpdateWorkItemCommentArgs = z.infer<typeof updateWorkItemCommentSchema>;

const deleteWorkItemCommentSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  comment_id: z.string(),
});
type DeleteWorkItemCommentArgs = z.infer<typeof deleteWorkItemCommentSchema>;

export async function listWorkItemComments(
  client: PlaneApi,
  args: ListWorkItemCommentsArgs
): Promise<ToolResult> {
  const data = await client.get<PaginationEnvelope<Comment>>(
    client.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/comments/`)
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export async function createWorkItemComment(
  client: PlaneApi,
  args: CreateWorkItemCommentArgs
): Promise<ToolResult> {
  const { project_id, work_item_id, comment_html } = args;
  const body = { comment_html };
  const comment = await client.post<Comment>(
    client.workspacePath(`projects/${project_id}/work-items/${work_item_id}/comments/`),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(comment) }],
    structuredContent: comment,
  };
}

export async function updateWorkItemComment(
  client: PlaneApi,
  args: UpdateWorkItemCommentArgs
): Promise<ToolResult> {
  const { project_id, work_item_id, comment_id, comment_html } = args;
  const body = { comment_html };
  const comment = await client.patch<Comment>(
    client.workspacePath(
      `projects/${project_id}/work-items/${work_item_id}/comments/${comment_id}/`
    ),
    body
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(comment) }],
    structuredContent: comment,
  };
}

export async function deleteWorkItemComment(
  client: PlaneApi,
  args: DeleteWorkItemCommentArgs
): Promise<ToolResult> {
  const { project_id, work_item_id, comment_id } = args;
  await client.delete(
    client.workspacePath(
      `projects/${project_id}/work-items/${work_item_id}/comments/${comment_id}/`
    )
  );
  return {
    content: [{ type: 'text', text: 'Comment deleted' }],
    structuredContent: { deleted: true },
  };
}

export function registerCommentTools(server: McpServer, client: PlaneApi): void {
  server.registerTool(
    'list_work_item_comments',
    {
      description: 'List comments for a work item.',
      inputSchema: listWorkItemCommentsSchema,
    },
    toolHandler('list_work_item_comments', client, listWorkItemComments)
  );

  server.registerTool(
    'create_work_item_comment',
    {
      description: 'Create a comment on a work item.',
      inputSchema: createWorkItemCommentSchema,
    },
    toolHandler('create_work_item_comment', client, createWorkItemComment)
  );

  server.registerTool(
    'update_work_item_comment',
    {
      description: 'Update a comment on a work item.',
      inputSchema: updateWorkItemCommentSchema,
    },
    toolHandler('update_work_item_comment', client, updateWorkItemComment)
  );

  server.registerTool(
    'delete_work_item_comment',
    {
      description: 'Delete a comment from a work item.',
      inputSchema: deleteWorkItemCommentSchema,
    },
    toolHandler('delete_work_item_comment', client, deleteWorkItemComment)
  );
}
