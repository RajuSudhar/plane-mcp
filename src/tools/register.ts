import type { PlaneApi } from '@types';
import type { ToolResult, ToolHandler, ServerConfig } from '@types';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { PlaneApiError } from '../plane/errors';
import { log } from '../logger';
import { resolveCeiling, resolveMaxOutputTokens } from '../config';
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

// Capability tables drive the guidance text so it can never recommend a
// parameter the breaching tool lacks. A drift test asserts each set against the
// registered Zod schemas.
export const FIELDS_TOOLS = new Set([
  'list_projects',
  'list_work_items',
  'search_work_items',
  'list_states',
  'list_labels',
  'list_cycles',
  'list_modules',
  'list_work_item_comments',
  'list_work_item_relations',
  'get_project_members',
  'get_workspace_members',
  'retrieve_project',
  'retrieve_work_item',
]);

// Only the three tools whose endpoint already returns a pagination envelope.
// The bare-array list tools (states, labels, cycles, modules, relations,
// members) deliberately do NOT take per_page — see plan 26, "Deviation".
export const PER_PAGE_TOOLS = new Set([
  'list_projects',
  'list_work_items',
  'list_work_item_comments',
]);

// Tools whose result set can be narrowed by scoping to a cycle or module
// instead of scanning a whole project.
export const SUB_FILTER_TOOLS = new Set(['list_work_items', 'search_work_items']);

// Tools that accept a per-request `max_output_tokens` override. Write tools
// return one small object and are excluded — they cannot realistically breach.
export const OVERRIDE_TOOLS = new Set([
  'list_projects',
  'retrieve_project',
  'list_work_items',
  'retrieve_work_item',
  'retrieve_work_item_by_identifier',
  'search_work_items',
  'list_states',
  'list_labels',
  'list_cycles',
  'list_modules',
  'list_work_item_comments',
  'list_work_item_relations',
  'get_project_members',
  'get_workspace_members',
]);

// Headroom on the suggested retry value: the same request re-run can differ
// slightly in size (timestamps, a comment added between calls).
const RETRY_SUGGESTION_MULTIPLIER = 1.1;

function buildTokenLimitGuidance(
  toolName: string,
  tokenCount: number,
  limit: number,
  ceiling: number
): string {
  const remedies: string[] = [];

  if (FIELDS_TOOLS.has(toolName)) {
    remedies.push(
      'pass `fields` to return only the keys you need (e.g. `fields: "id,name"`), which is usually the largest reduction'
    );
  }
  if (PER_PAGE_TOOLS.has(toolName)) {
    remedies.push('reduce `per_page` and page through the result');
  }
  if (SUB_FILTER_TOOLS.has(toolName)) {
    remedies.push('scope the request with `cycle_id` or `module_id` instead of the whole project');
  }
  if (toolName !== 'retrieve_work_item_by_identifier') {
    remedies.push(
      'call `retrieve_work_item_by_identifier` for a single known item instead of listing or searching'
    );
  }

  const suggested = Math.ceil((tokenCount * RETRY_SUGGESTION_MULTIPLIER) / 1000) * 1000;
  const canRaise = OVERRIDE_TOOLS.has(toolName) && suggested <= ceiling;

  if (canRaise) {
    remedies.push(
      `retry this same call with \`max_output_tokens: ${suggested}\` to receive the full result anyway (ceiling ${ceiling})`
    );
  }

  const head =
    `Tool "${toolName}" result was withheld: the response is an estimated ` +
    `${tokenCount} tokens, exceeding the limit of ${limit} for this tool.`;

  const raiseNote =
    !canRaise && OVERRIDE_TOOLS.has(toolName)
      ? ` Raising the limit cannot help here — ${tokenCount} tokens exceeds the ceiling of ${ceiling}, and a response that large would not fit in context. Narrow the request instead.`
      : '';

  const tail =
    ` Configure the standing limit via the PLANE_MCP_MAX_OUTPUT_TOKENS env var or a "${toolName}"` +
    ' entry under `tools` in your plane-mcp config file.';

  return `${head}${raiseNote} Options: ${remedies.join('; ')}.${tail}`;
}

function buildCeilingError(toolName: string, requested: number, ceiling: number): string {
  return (
    `Tool "${toolName}" was not called: requested \`max_output_tokens\` of ${requested} ` +
    `exceeds the ceiling of ${ceiling}. Lower the request, or raise ` +
    '`defaults.maxOutputTokensCeiling` in your plane-mcp config file if a payload ' +
    'that large is genuinely wanted.'
  );
}

function readOverride(args: unknown): number | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const value = (args as Record<string, unknown>).max_output_tokens;
  return typeof value === 'number' ? value : undefined;
}

// `max_output_tokens` is a server-side directive, never a Plane query param.
// Strip it centrally so no tool can forward it via a `...rest` spread.
function stripOverride(args: unknown): unknown {
  if (typeof args !== 'object' || args === null) return args;
  if (!('max_output_tokens' in args)) return args;
  const { max_output_tokens: _omitted, ...rest } = args as Record<string, unknown>;
  return rest;
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

    const ceiling = resolveCeiling(config);
    const override = readOverride(args);

    if (override !== undefined && override > ceiling) {
      log('warn', 'Requested max_output_tokens exceeds ceiling; call not made', {
        operation: 'tool_execute',
        toolName,
        requested: override,
        ceiling,
      });
      return {
        content: [{ type: 'text', text: buildCeilingError(toolName, override, ceiling) }],
        isError: true,
      };
    }

    try {
      const result: ToolResult = await fn(client, stripOverride(args) as TArgs);

      if (result.isError) {
        // Already an error result — pass through unchanged, never counted
        // or reinterpreted as a token-limit rejection.
        return result;
      }

      const tokenCount = countOutputTokens(result);
      const { limit, source } = resolveMaxOutputTokens(config, toolName, override);

      if (tokenCount > limit) {
        log('warn', 'Tool output exceeded configured token limit; result withheld', {
          operation: 'tool_execute',
          toolName,
          tokenCount,
          limit,
          limitSource: source,
        });
        return {
          content: [
            { type: 'text', text: buildTokenLimitGuidance(toolName, tokenCount, limit, ceiling) },
          ],
          isError: true,
        };
      }

      log('info', 'Tool execution complete', {
        operation: 'tool_execute',
        toolName,
        durationMs: Date.now() - startedAt,
        tokenCount,
        limitSource: source,
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
