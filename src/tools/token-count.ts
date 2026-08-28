import { encode } from 'gpt-tokenizer/model/gpt-4o';
import type { ToolResult } from '@types';

// gpt-tokenizer's o200k_base (GPT-4o family) encoding undercounts actual
// Claude token usage by roughly 15-20% on typical JSON payloads (different
// tokenizer vocabulary/merge rules) — applying a fixed multiplier keeps the
// enforced limit conservative without maintaining a second, Claude-specific
// tokenizer dependency.
export const TOKEN_COUNT_MULTIPLIER = 1.2;

// Counts the tokens of the ACTUAL outgoing payload: every text part of
// `content` plus `structuredContent` if present, concatenated exactly as
// the MCP client receives them (both are sent — see register.ts). This
// deliberately does not deduplicate `content`/`structuredContent` even
// when they carry the same underlying object (today's every-tool
// behavior) — the counter must reflect what actually goes over the wire,
// not what an idealized single-representation payload would cost. See
// Phase 23 doc, "Coordination with Phases 17/19/20".
export function countOutputTokens(result: ToolResult): number {
  const textPayload = result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const structuredPayload = result.structuredContent
    ? JSON.stringify(result.structuredContent)
    : '';
  const payload = textPayload + structuredPayload;
  return Math.ceil(encode(payload).length * TOKEN_COUNT_MULTIPLIER);
}
