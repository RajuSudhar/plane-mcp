import type { AuthContext, LoadServerConfigDeps, ServerConfig, ToolSettings } from '@types';
import { log } from './logger';
import { getSecret } from './secrets';
import { z } from 'zod';
import * as path from 'node:path';
import { readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
import { getConfigDir } from './paths';

const DEFAULT_BASE_URL = 'https://api.plane.so';
const DEFAULT_PORT = 3000;

export async function loadAuthContext(
  getSecretFn?: (name: string) => Promise<string | null>
): Promise<AuthContext> {
  const secret = getSecretFn ?? getSecret;
  let apiKey: string | null | undefined = process.env.PLANE_API_KEY;

  // Step (a): Check PLANE_API_KEY env var first
  if (apiKey) {
    // apiKey is set and non-empty; use it
  } else {
    // Step (b): Check PLANE_MCP_INSTANCE and resolve via keychain
    const instance = process.env.PLANE_MCP_INSTANCE;
    if (instance) {
      const key = await secret(instance);
      if (!key) {
        log('error', 'No stored credential for instance', {
          operation: 'config_load',
          instance,
          error: 'credential_not_found',
        });
        throw new Error(
          `No stored credential for instance "${instance}". Run: plane-mcp init ${instance}`
        );
      }
      apiKey = key;
    } else {
      // Step (c): Neither env var nor instance provided
      log('error', 'Missing API key configuration', {
        operation: 'config_load',
        error: 'no_api_key_or_instance',
      });
      throw new Error(
        'PLANE_API_KEY is not set and no PLANE_MCP_INSTANCE was provided. Run "plane-mcp init <name>" to store a key, or set PLANE_API_KEY.'
      );
    }
  }

  const workspaceSlug = process.env.PLANE_WORKSPACE_SLUG;

  if (!workspaceSlug) {
    log('error', 'Missing required env var', {
      operation: 'config_load',
      error: 'PLANE_WORKSPACE_SLUG unset',
    });
    throw new Error('PLANE_WORKSPACE_SLUG is required');
  }

  const baseUrl = process.env.PLANE_BASE_URL ?? DEFAULT_BASE_URL;

  if (!baseUrl.startsWith('https://')) {
    log('error', 'Invalid PLANE_BASE_URL', {
      operation: 'config_load',
      error: 'PLANE_BASE_URL must use https',
    });
    throw new Error('PLANE_BASE_URL must use https');
  }

  log('info', 'AuthContext loaded', {
    operation: 'config_load',
    baseUrl,
  });

  return { apiKey, workspaceSlug, baseUrl };
}

export function loadPort(): number {
  const raw = process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    log('error', 'Invalid PORT', {
      operation: 'config_load',
      error: `PORT must be a valid integer, got: ${raw}`,
    });
    throw new Error(`PORT must be a valid integer, got: ${raw}`);
  }
  if (parsed < 1 || parsed > 65535) {
    log('error', 'Invalid PORT', {
      operation: 'config_load',
      error: `PORT must be between 1 and 65535, got: ${parsed}`,
    });
    throw new Error(`PORT must be between 1 and 65535, got: ${parsed}`);
  }
  return parsed;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 25000;

// Mirrors types/config.ts's ToolSettings/ServerConfig shape exactly, so the
// value returned by a successful `.parse()` is structurally assignable to
// ServerConfig with no cast. `.strict()` on every object level means an
// unknown/misspelled key (e.g. "maxOutputTokns") is a validation error, not
// a silently ignored no-op.
const toolSettingsSchema = z
  .object({
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

const serverConfigSchema = z
  .object({
    // Allowed so `$schema": "..."` (editor IntelliSense / JSON Schema
    // validation) can sit in a real config file without tripping .strict();
    // never read for behavior.
    $schema: z.string().optional(),
    defaults: toolSettingsSchema.optional(),
    tools: z.record(z.string(), toolSettingsSchema).optional(),
  })
  .strict();

const defaultFileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fsStat(filePath);
    return true;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
};

function formatConfigError(configPath: string, error: z.ZodError): string {
  return `Invalid plane-mcp config at ${configPath}:\n${z.prettifyError(error)}`;
}

async function resolveConfigPath(
  fileExists: (p: string) => Promise<boolean>
): Promise<string | null> {
  const explicit = process.env.PLANE_MCP_CONFIG;
  if (explicit) {
    if (!path.isAbsolute(explicit)) {
      throw new Error(`PLANE_MCP_CONFIG must be an absolute path, got: ${explicit}`);
    }
    if (!(await fileExists(explicit))) {
      throw new Error(`PLANE_MCP_CONFIG points to a file that does not exist: ${explicit}`);
    }
    return explicit;
  }

  const cwdConfig = path.join(process.cwd(), 'plane-mcp.config.json');
  if (await fileExists(cwdConfig)) {
    return cwdConfig;
  }

  const xdgConfig = path.join(getConfigDir(), 'config.json');
  if (await fileExists(xdgConfig)) {
    return xdgConfig;
  }

  return null;
}

function resolveEnvOverride(): number | undefined {
  const raw = process.env.PLANE_MCP_MAX_OUTPUT_TOKENS;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`PLANE_MCP_MAX_OUTPUT_TOKENS must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

export async function loadServerConfig(deps?: LoadServerConfigDeps): Promise<ServerConfig> {
  const readFile = deps?.readFile ?? ((p: string) => fsReadFile(p, 'utf-8'));
  const fileExists = deps?.fileExists ?? defaultFileExists;

  const configPath = await resolveConfigPath(fileExists);

  let fileDefaults: ToolSettings = {};
  let fileTools: Record<string, ToolSettings> = {};

  if (configPath) {
    const raw = await readFile(configPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid JSON in plane-mcp config at ${configPath}: ${msg}`);
    }

    const result = serverConfigSchema.safeParse(parsed);
    if (!result.success) {
      log('error', 'Invalid server config', {
        operation: 'config_load',
        configPath,
      });
      throw new Error(formatConfigError(configPath, result.error));
    }

    fileDefaults = result.data.defaults ?? {};
    fileTools = result.data.tools ?? {};

    log('info', 'Server config loaded', { operation: 'config_load', configPath });
  } else {
    log('info', 'No server config file found; using built-in defaults', {
      operation: 'config_load',
    });
  }

  const envOverride = resolveEnvOverride();

  const resolved: ServerConfig = {
    defaults: {
      maxOutputTokens: envOverride ?? fileDefaults.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    },
    tools: fileTools,
  };

  return resolved;
}

export function resolveMaxOutputTokens(config: ServerConfig, toolName: string): number {
  return (
    config.tools[toolName]?.maxOutputTokens ??
    config.defaults.maxOutputTokens ??
    DEFAULT_MAX_OUTPUT_TOKENS
  );
}

export { serverConfigSchema, DEFAULT_MAX_OUTPUT_TOKENS };
