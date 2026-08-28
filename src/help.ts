import { DEFAULT_MAX_OUTPUT_TOKENS } from './config';

export function buildHelpText(): string {
  return `plane-mcp — MCP server for Plane

Usage:
  plane-mcp                          Run the stdio MCP server (default)
  plane-mcp init <name> [options]    Store an API key and scaffold config
  plane-mcp help, --help, -h         Show this help

init options:
  --workspace <slug>            Workspace slug (required)
  --base-url <url>              API base URL (default: https://api.plane.so)
  --port <port>                 Server port (default: 3000)
  --key <key>                   API key for scripted/CI use (visible in
                                 process list; interactive hidden prompt is
                                 the secure default)
  --register                    Auto-register with claude mcp add
  -y                             Skip config-scaffold prompts, use defaults
  --config-path <path>          Config file location (default:
                                 ~/.config/plane-mcp/config.json)
  --max-output-tokens <n>       Default per-tool output-token limit written
                                 to the scaffolded config (default: 25000)

Behavior config (plane-mcp.config.json):
  Discovery order: PLANE_MCP_CONFIG env (absolute path) >
  ./plane-mcp.config.json (cwd) > ~/.config/plane-mcp/config.json >
  built-in defaults (${DEFAULT_MAX_OUTPUT_TOKENS} tokens/tool)
  Shape: {"defaults": {"maxOutputTokens": N}, "tools": {"<tool_name>":
  {"maxOutputTokens": N}}}
  Env override: PLANE_MCP_MAX_OUTPUT_TOKENS overrides defaults.maxOutputTokens

Auth env vars:
  PLANE_API_KEY            Direct API key (CI/dev fallback, skips keychain)
  PLANE_MCP_INSTANCE       Named instance to resolve from the OS keychain
  PLANE_WORKSPACE_SLUG     Workspace identifier (required)
  PLANE_BASE_URL           API base URL (default: https://api.plane.so)
  PORT                     HTTP server port (default: 3000)

Run "plane-mcp init <name> --workspace <slug>" to get started.
`;
}

export function printHelp(write: (s: string) => void = (s) => process.stdout.write(s)): void {
  // Default write uses process.stdout.write for the one-shot CLI path (not the JSON-RPC server path)
  write(buildHelpText());
}
