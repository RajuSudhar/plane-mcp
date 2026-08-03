import type { PlaneClient } from '../src/plane/client';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type ToolHandler<TArgs> = (client: PlaneClient, args: TArgs) => Promise<ToolResult>;
