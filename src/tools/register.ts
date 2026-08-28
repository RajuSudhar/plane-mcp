import type { PlaneApi } from '@types';
import type { ToolResult, ToolHandler, ServerConfig } from '@types';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { PlaneApiError } from '../plane/errors';
import { log } from '../logger';
import { resolveMaxOutputTokens } from '../config';
import { countOutputTokens } from './token-count';

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

function buildTokenLimitGuidance(toolName: string, tokenCount: number, limit: number): string {
  return (
    `Tool "${toolName}" result was withheld: the response is an estimated ` +
    `${tokenCount} tokens, exceeding the configured limit of ${limit} for ` +
    `this tool. Narrow the request and try again — for example: pass ` +
    `fields to request specific fields instead of the full object, ` +
    `reduce per_page, filter list_work_items/search_work_items by ` +
    `module_id or cycle_id instead of scanning a whole project, or call ` +
    `retrieve_work_item_by_identifier for a single known item instead of ` +
    `listing or searching. Configure this limit via the ` +
    `PLANE_MCP_MAX_OUTPUT_TOKENS env var or a "${toolName}" entry under ` +
    `tools in your plane-mcp config file.`
  );
}

export function toolHandler<TArgs extends Record<string, unknown>>(
  toolName: string,
  client: PlaneApi,
  fn: ToolHandler<TArgs>,
  config: ServerConfig
): (args: unknown) => Promise<CallToolResult> {
  return async (args: unknown): Promise<CallToolResult> => {
    log('info', 'Executing tool', { operation: 'tool_execute', toolName });
    const startedAt = Date.now();
    try {
      const result: ToolResult = await fn(client, args as TArgs);

      if (result.isError) {
        // Already an error result — pass through unchanged, never counted
        // or reinterpreted as a token-limit rejection.
        return result;
      }

      const tokenCount = countOutputTokens(result);
      const limit = resolveMaxOutputTokens(config, toolName);

      if (tokenCount > limit) {
        log('warn', 'Tool output exceeded configured token limit; result withheld', {
          operation: 'tool_execute',
          toolName,
          tokenCount,
          limit,
        });
        return {
          content: [{ type: 'text', text: buildTokenLimitGuidance(toolName, tokenCount, limit) }],
          isError: true,
        };
      }

      log('info', 'Tool execution complete', {
        operation: 'tool_execute',
        toolName,
        durationMs: Date.now() - startedAt,
        tokenCount,
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
