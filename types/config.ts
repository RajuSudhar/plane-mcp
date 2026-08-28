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

type ServerConfig = {
  defaults: ToolSettings;
  tools: Record<string, ToolSettings>;
};

type LoadServerConfigDeps = {
  readFile?: (filePath: string) => Promise<string>;
  fileExists?: (filePath: string) => Promise<boolean>;
};

export type { AuthContext, EnvConfig, ToolSettings, ServerConfig, LoadServerConfigDeps };
