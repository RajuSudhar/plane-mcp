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

export type { AuthContext, EnvConfig };
