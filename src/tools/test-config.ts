import type { ServerConfig } from '@types';

// Shared test fixture with generous token limits so existing tests never trip enforcement
export const testConfig: ServerConfig = {
  defaults: { maxOutputTokens: 1_000_000 },
  tools: {},
};
