import type { AuthContext } from '@types';
import { log } from './logger';

const DEFAULT_BASE_URL = 'https://api.plane.so';
const DEFAULT_PORT = 3000;

export function loadAuthContext(): AuthContext {
  const apiKey = process.env.PLANE_API_KEY;
  const workspaceSlug = process.env.PLANE_WORKSPACE_SLUG;

  if (!apiKey) {
    log('error', 'Missing required env var', {
      operation: 'config_load',
      error: 'PLANE_API_KEY unset',
    });
    throw new Error('PLANE_API_KEY is required');
  }
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
