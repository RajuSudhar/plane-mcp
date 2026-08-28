import * as os from 'node:os';
import * as path from 'node:path';

// Shared by src/secrets.ts (credentials.json) and src/config.ts
// (config.json) — both live under the same plane-mcp config directory, and
// both must resolve it identically or a user setting PLANE_MCP_CONFIG_DIR
// once would split secrets and behavior config into two different places.
export function getConfigDir(): string {
  return (
    process.env.PLANE_MCP_CONFIG_DIR ??
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'plane-mcp')
  );
}
