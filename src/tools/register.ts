import type { PlaneApi } from '@types';
import type { ToolResult, ToolHandler } from '@types';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { PlaneApiError } from '../plane/errors';
import { log } from '../logger';

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
