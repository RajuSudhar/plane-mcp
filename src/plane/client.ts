import type { AuthContext } from '@types';
import { PlaneApiError, PlaneRateLimitError } from './errors';
import { log } from '../logger';

const MAX_RETRIES = 3;

type RequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export class PlaneClient {
  private readonly auth: AuthContext;

  constructor(auth: AuthContext) {
    this.auth = auth;
  }

  workspacePath(sub: string): string {
    return `/api/v1/workspaces/${this.auth.workspaceSlug}/${sub.replace(/^\//, '')}`;
  }

  private sanitizeEndpoint(path: string): string {
    return path.split('/workspaces/' + this.auth.workspaceSlug).join('/workspaces/{workspace}');
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>({ method: 'GET', path, query });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', path, body });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>({ method: 'DELETE', path });
  }

  private async request<T>(options: RequestOptions, attempt = 0): Promise<T> {
    const url = new URL(options.path, this.auth.baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    log('debug', 'Calling Plane API', {
      operation: 'api_request',
      endpoint: this.sanitizeEndpoint(options.path),
      method: options.method,
    });

    const response = await fetch(url.toString(), {
      method: options.method,
      headers: {
        'X-API-Key': this.auth.apiKey,
        'Content-Type': 'application/json',
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    log('debug', 'Plane API response', {
      operation: 'api_response',
      endpoint: this.sanitizeEndpoint(options.path),
      statusCode: response.status,
    });

    if (response.status === 429) {
      const resetHeader = response.headers.get('X-RateLimit-Reset');
      const resetAt = resetHeader ? Number.parseInt(resetHeader, 10) : 0;
      if (attempt < MAX_RETRIES) {
        const waitSeconds = Math.max(1, resetAt - Math.floor(Date.now() / 1000));
        log('warn', 'Rate limited, backing off', {
          operation: 'api_rate_limit',
          endpoint: this.sanitizeEndpoint(options.path),
          statusCode: 429,
          waitSeconds,
        });
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitSeconds, 30) * 1000));
        return this.request<T>(options, attempt + 1);
      }
      const body = await response.text();
      log('error', 'Rate limit retries exhausted', {
        operation: 'api_error',
        endpoint: this.sanitizeEndpoint(options.path),
        statusCode: 429,
      });
      throw new PlaneRateLimitError(body, resetAt);
    }

    if (response.status >= 400) {
      const body = await response.text();
      log('error', 'Plane API request failed', {
        operation: 'api_error',
        endpoint: this.sanitizeEndpoint(options.path),
        statusCode: response.status,
        error: body,
      });
      throw new PlaneApiError(response.status, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }
}
