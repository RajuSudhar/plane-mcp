import type { AuthContext } from '@types';
import { log } from './logger';
import { getSecret } from './secrets';

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
