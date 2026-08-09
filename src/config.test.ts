import { describe, it, expect } from 'bun:test';
import { loadAuthContext, loadPort } from './config';

// Save and restore process.env to avoid test pollution
function withEnv(fn: () => Promise<void> | void): () => Promise<void> {
  return async () => {
    const savedEnv = { ...process.env };
    try {
      await fn();
    } finally {
      process.env = savedEnv;
    }
  };
}

describe('config module', () => {
  describe('loadAuthContext', () => {
    describe('(a) PLANE_API_KEY from env', () => {
      it(
        'resolves apiKey from env when PLANE_API_KEY is set and non-empty',
        withEnv(async () => {
          process.env.PLANE_API_KEY = 'env-api-key-123';
          process.env.PLANE_WORKSPACE_SLUG = 'my-workspace';
          // Clear PLANE_MCP_INSTANCE to ensure it's not consulted
          delete process.env.PLANE_MCP_INSTANCE;

          // Inject a getSecretFn that would throw if called
          const throwingGetSecret = async () => {
            throw new Error('getSecret should not be called when PLANE_API_KEY is set');
          };

          const auth = await loadAuthContext(throwingGetSecret);

          expect(auth.apiKey).toBe('env-api-key-123');
          expect(auth.workspaceSlug).toBe('my-workspace');
          expect(auth.baseUrl).toBe('https://api.plane.so');
        })
      );

      it(
        'uses PLANE_BASE_URL when provided',
        withEnv(async () => {
          process.env.PLANE_API_KEY = 'env-api-key-123';
          process.env.PLANE_WORKSPACE_SLUG = 'my-workspace';
          process.env.PLANE_BASE_URL = 'https://custom.plane.io';
          delete process.env.PLANE_MCP_INSTANCE;

          const auth = await loadAuthContext();

          expect(auth.baseUrl).toBe('https://custom.plane.io');
        })
      );
    });

    describe('(b) PLANE_MCP_INSTANCE-keyed keychain resolution', () => {
      it(
        'resolves apiKey from keychain when PLANE_API_KEY is unset and PLANE_MCP_INSTANCE is set',
        withEnv(async () => {
          delete process.env.PLANE_API_KEY;
          process.env.PLANE_MCP_INSTANCE = 'acme';
          process.env.PLANE_WORKSPACE_SLUG = 'acme-workspace';

          const mockGetSecret = async (name: string) => {
            if (name === 'acme') return 'keychain-stored-key-xyz';
            return null;
          };

          const auth = await loadAuthContext(mockGetSecret);

          expect(auth.apiKey).toBe('keychain-stored-key-xyz');
          expect(auth.workspaceSlug).toBe('acme-workspace');
        })
      );

      it(
        'tracks that getSecretFn was called with the instance name',
        withEnv(async () => {
          delete process.env.PLANE_API_KEY;
          process.env.PLANE_MCP_INSTANCE = 'test-instance';
          process.env.PLANE_WORKSPACE_SLUG = 'test-workspace';

          const calls: string[] = [];

          const trackingGetSecret = async (name: string) => {
            calls.push(name);
            return 'test-key';
          };

          await loadAuthContext(trackingGetSecret);

          expect(calls.length).toBe(1);
          if (calls.length > 0) {
            expect(calls[0]).toBe('test-instance');
          }
        })
      );

      it(
        'throws with guidance when instance key is not found in keychain',
        withEnv(async () => {
          delete process.env.PLANE_API_KEY;
          process.env.PLANE_MCP_INSTANCE = 'missing-instance';
          process.env.PLANE_WORKSPACE_SLUG = 'test-workspace';

          const mockGetSecret = async () => null;

          try {
            await loadAuthContext(mockGetSecret);
            expect(false).toBe(true); // Should have thrown
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain('No stored credential for instance');
            expect(message).toContain('missing-instance');
            expect(message).toContain('plane-mcp init');
          }
        })
      );

      it(
        'throws with guidance when instance key is empty string',
        withEnv(async () => {
          delete process.env.PLANE_API_KEY;
          process.env.PLANE_MCP_INSTANCE = 'empty-instance';
          process.env.PLANE_WORKSPACE_SLUG = 'test-workspace';

          const mockGetSecret = async () => '';

          try {
            await loadAuthContext(mockGetSecret);
            expect(false).toBe(true); // Should have thrown
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain('No stored credential for instance');
            expect(message).toContain('empty-instance');
          }
        })
      );
    });

    describe('(c) Neither PLANE_API_KEY nor PLANE_MCP_INSTANCE', () => {
      it(
        'throws with clear guidance when neither env key nor instance is set',
        withEnv(async () => {
          delete process.env.PLANE_API_KEY;
          delete process.env.PLANE_MCP_INSTANCE;
          process.env.PLANE_WORKSPACE_SLUG = 'test-workspace';

          try {
            await loadAuthContext();
            expect(false).toBe(true); // Should have thrown
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain('PLANE_API_KEY is not set');
            expect(message).toContain('PLANE_MCP_INSTANCE');
            expect(message).toContain('plane-mcp init');
          }
        })
      );
    });

    describe('workspace slug validation', () => {
      it(
        'throws when PLANE_WORKSPACE_SLUG is missing',
        withEnv(async () => {
          process.env.PLANE_API_KEY = 'test-key';
          delete process.env.PLANE_WORKSPACE_SLUG;

          try {
            await loadAuthContext();
            expect(false).toBe(true); // Should have thrown
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain('PLANE_WORKSPACE_SLUG');
          }
        })
      );
    });

    describe('base URL validation', () => {
      it(
        'throws when PLANE_BASE_URL does not start with https://',
        withEnv(async () => {
          process.env.PLANE_API_KEY = 'test-key';
          process.env.PLANE_WORKSPACE_SLUG = 'test-workspace';
          process.env.PLANE_BASE_URL = 'http://insecure.plane.io';

          try {
            await loadAuthContext();
            expect(false).toBe(true); // Should have thrown
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain('PLANE_BASE_URL must use https');
          }
        })
      );

      it(
        'accepts valid https:// URLs',
        withEnv(async () => {
          process.env.PLANE_API_KEY = 'test-key';
          process.env.PLANE_WORKSPACE_SLUG = 'test-workspace';
          process.env.PLANE_BASE_URL = 'https://custom.example.com';

          const auth = await loadAuthContext();

          expect(auth.baseUrl).toBe('https://custom.example.com');
        })
      );
    });

    describe('return value shape', () => {
      it(
        'returns object with apiKey, workspaceSlug, and baseUrl fields',
        withEnv(async () => {
          process.env.PLANE_API_KEY = 'test-api-key';
          process.env.PLANE_WORKSPACE_SLUG = 'test-slug';

          const auth = await loadAuthContext();

          expect(typeof auth.apiKey).toBe('string');
          expect(typeof auth.workspaceSlug).toBe('string');
          expect(typeof auth.baseUrl).toBe('string');
          expect(auth).toHaveProperty('apiKey');
          expect(auth).toHaveProperty('workspaceSlug');
          expect(auth).toHaveProperty('baseUrl');
        })
      );
    });
  });

  describe('loadPort', () => {
    describe('default behavior', () => {
      it(
        'returns DEFAULT_PORT (3000) when PORT is not set',
        withEnv(() => {
          delete process.env.PORT;

          const port = loadPort();

          expect(port).toBe(3000);
        })
      );
    });

    describe('env override', () => {
      it(
        'parses PORT from env as integer',
        withEnv(() => {
          process.env.PORT = '8080';

          const port = loadPort();

          expect(port).toBe(8080);
        })
      );

      it(
        'throws for invalid PORT (non-integer)',
        withEnv(() => {
          process.env.PORT = 'not-a-number';

          try {
            loadPort();
            expect(false).toBe(true); // Should have thrown
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain('PORT must be a valid integer');
          }
        })
      );

      it(
        'throws for PORT out of valid range (< 1)',
        withEnv(() => {
          process.env.PORT = '0';

          try {
            loadPort();
            expect(false).toBe(true); // Should have thrown
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain('PORT must be between 1 and 65535');
          }
        })
      );

      it(
        'throws for PORT out of valid range (> 65535)',
        withEnv(() => {
          process.env.PORT = '65536';

          try {
            loadPort();
            expect(false).toBe(true); // Should have thrown
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain('PORT must be between 1 and 65535');
          }
        })
      );

      it(
        'accepts valid PORT in range [1, 65535]',
        withEnv(() => {
          process.env.PORT = '9000';

          const port = loadPort();

          expect(port).toBe(9000);
        })
      );
    });
  });
});
