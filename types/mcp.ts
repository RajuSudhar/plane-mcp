import type { PlaneApi } from './client';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type ToolHandler<TArgs> = (client: PlaneApi, args: TArgs) => Promise<ToolResult>;
