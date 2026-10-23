type AuthContext = {
  apiKey: string;
  workspaceSlug: string;
  baseUrl: string;
};

type EnvConfig = {
  PLANE_API_KEY: string;
  PLANE_WORKSPACE_SLUG: string;
  PLANE_BASE_URL: string;
  PORT: number;
};

type ToolSettings = {
  maxOutputTokens?: number;
};

// Ceiling is global, not per-tool: it bounds what a caller may request via a
// tool's max_output_tokens argument, so a per-tool ceiling would be meaningless.
type ServerDefaults = ToolSettings & {
  maxOutputTokensCeiling?: number;
};

type ServerConfig = {
  defaults: ServerDefaults;
  tools: Record<string, ToolSettings>;
};

// Where the limit applied to a given call came from, so guidance can name it.
// 'default' covers env, config-file defaults, and the built-in — loadServerConfig
// collapses those three before resolution, so they are not distinguishable here.
type LimitSource = 'request' | 'tool-config' | 'default';

type ResolvedLimit = {
  limit: number;
  source: LimitSource;
};

type LoadServerConfigDeps = {
  readFile?: (filePath: string) => Promise<string>;
  fileExists?: (filePath: string) => Promise<boolean>;
};

export type {
  AuthContext,
  EnvConfig,
  ToolSettings,
  ServerDefaults,
  ServerConfig,
  LoadServerConfigDeps,
  LimitSource,
  ResolvedLimit,
};
