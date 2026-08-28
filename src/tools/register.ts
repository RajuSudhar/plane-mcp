import type { PlaneApi } from '@types';
import type { ToolResult, ToolHandler } from '@types';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { PlaneApiError } from '../plane/errors';
import { log } from '../logger';

export const WORK_ITEM_ID_TOOLS = new Set([
  'retrieve_work_item',
  'update_work_item',
  'delete_work_item',
  'list_work_item_comments',
  'create_work_item_comment',
  'update_work_item_comment',
  'delete_work_item_comment',
  'list_work_item_relations',
  'create_work_item_relation',
  'remove_work_item_relation',
  'add_work_items_to_cycle',
  'remove_work_item_from_cycle',
  'add_work_items_to_module',
  'remove_work_item_from_module',
]);

export function toolHandler<TArgs extends Record<string, unknown>>(
  toolName: string,
  client: PlaneApi,
  fn: ToolHandler<TArgs>
): (args: unknown) => Promise<CallToolResult> {
  return async (args: unknown): Promise<CallToolResult> => {
    log('info', 'Executing tool', { operation: 'tool_execute', toolName });
    const startedAt = Date.now();
    try {
      const result: ToolResult = await fn(client, args as TArgs);
      log('info', 'Tool execution complete', {
        operation: 'tool_execute',
        toolName,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      let errorMessage: string;
      let errorDetail: string;

      if (err instanceof PlaneApiError) {
        errorMessage = err.message;
        errorDetail = err.message;
        if (err.status === 404 && WORK_ITEM_ID_TOOLS.has(toolName)) {
          errorMessage =
            err.message +
            ' Hint: work item ids must be UUIDs, not human identifiers like BZ-5777. Call retrieve_work_item_by_identifier to resolve a human identifier to its UUID first.';
        }
      } else {
        errorMessage = 'Unexpected error';
        errorDetail = 'unexpected';
      }

      log('error', 'Tool execution error', {
        operation: 'tool_execute',
        toolName,
        error: errorDetail,
      });
      return {
        content: [{ type: 'text', text: errorMessage }],
        isError: true,
      };
    }
  };
}
