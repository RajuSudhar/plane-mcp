import { describe, it, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server';
import type { AuthContext } from '@types';

describe('stdio transport', () => {
  it('should handle JSON-RPC initialize request', async () => {
    const auth: AuthContext = {
      apiKey: 'test-key',
      workspaceSlug: 'test-workspace',
      baseUrl: 'https://api.plane.so',
    };

    const server = createServer(auth);
    const input = new PassThrough();
    const output = new PassThrough();

    const transport = new StdioServerTransport(input, output);
    const connectPromise = server.connect(transport);

    let captured = '';
    output.on('data', (chunk: Buffer) => {
      captured += chunk.toString();
    });

    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '0.0.0',
        },
      },
    };

    input.write(JSON.stringify(initRequest) + '\n');

    await connectPromise;

    // Event-driven wait: resolve as soon as a complete JSON-RPC response
    // with id === 1 is received, bounded by a 4-second timeout
    const gotResponse = new Promise<void>((resolve, _reject) => {
      const checkResponse = () => {
        const lines = captured.trim().split('\n');
        const responses = lines
          .map((line) => {
            try {
              return JSON.parse(line) as unknown;
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        const initResponse = responses.find(
          (r) => typeof r === 'object' && r !== null && (r as Record<string, unknown>).id === 1
        );
        if (initResponse) {
          resolve();
        }
      };

      const dataListener = () => checkResponse();
      output.on('data', dataListener);

      // Also check in case data arrived before listener was attached
      checkResponse();
    });

    const timeoutThatRejects = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for JSON-RPC response')), 4000);
    });

    try {
      await Promise.race([gotResponse, timeoutThatRejects]);

      expect(captured).toContain('plane-mcp');

      const lines = captured.trim().split('\n');
      const responses = lines
        .map((line) => {
          try {
            return JSON.parse(line) as unknown;
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const initResponse = responses.find(
        (r) => typeof r === 'object' && r !== null && (r as Record<string, unknown>).id === 1
      );
      expect(initResponse).toBeDefined();
      if (
        initResponse &&
        typeof initResponse === 'object' &&
        initResponse !== null &&
        'result' in initResponse &&
        typeof (initResponse as Record<string, unknown>).result === 'object' &&
        (initResponse as Record<string, unknown>).result !== null &&
        'serverInfo' in ((initResponse as Record<string, unknown>).result as object) &&
        typeof ((initResponse as Record<string, unknown>).result as Record<string, unknown>)
          .serverInfo === 'object'
      ) {
        const serverInfo = (
          (initResponse as Record<string, unknown>).result as Record<string, unknown>
        ).serverInfo as Record<string, unknown>;
        expect(serverInfo.name).toBe('plane-mcp');
      }
    } finally {
      await transport.close();
    }
  }, 5000);
});
