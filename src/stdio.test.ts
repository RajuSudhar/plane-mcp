import { describe, it, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server';
import { resolveCommand } from './stdio';
import type { AuthContext, ServerConfig } from '@types';

type JsonRpcResponse = {
  id: number;
  result?: Record<string, unknown>;
};

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as Record<string, unknown>).id === 'number'
  );
}

describe('resolveCommand', () => {
  it('resolves help subcommand', () => {
    const result = resolveCommand(['help']);
    expect(result.command).toBe('help');
  });

  it('resolves --help flag', () => {
    const result = resolveCommand(['--help']);
    expect(result.command).toBe('help');
  });

  it('resolves -h flag', () => {
    const result = resolveCommand(['-h']);
    expect(result.command).toBe('help');
  });

  it('prioritizes help over init when --help is used with init', () => {
    const result = resolveCommand(['init', '--help']);
    expect(result.command).toBe('help');
  });

  it('resolves init subcommand', () => {
    const result = resolveCommand(['init', 'foo']);
    expect(result.command).toBe('init');
    expect(result.rest).toEqual(['foo']);
  });

  it('defaults to server command with empty argv', () => {
    const result = resolveCommand([]);
    expect(result.command).toBe('server');
    expect(result.rest).toEqual([]);
  });

  it('defaults to server command with no recognized subcommand', () => {
    const result = resolveCommand(['unknown']);
    expect(result.command).toBe('server');
    expect(result.rest).toEqual(['unknown']);
  });

  it('passes rest arguments correctly for init', () => {
    const result = resolveCommand(['init', 'myinstance', '--workspace', 'test-ws']);
    expect(result.command).toBe('init');
    expect(result.rest).toEqual(['myinstance', '--workspace', 'test-ws']);
  });
});

describe('stdio transport', () => {
  it('should handle JSON-RPC initialize request', async () => {
    const auth: AuthContext = {
      apiKey: 'test-key',
      workspaceSlug: 'test-workspace',
      baseUrl: 'https://api.plane.so',
    };
    const config: ServerConfig = {
      defaults: { maxOutputTokens: 1_000_000 },
      tools: {},
    };

    const server = createServer(auth, config);
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
        const responses: unknown[] = lines
          .map((line) => {
            try {
              return JSON.parse(line) as unknown;
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        const initResponse = responses.find(
          (r): r is JsonRpcResponse => isJsonRpcResponse(r) && r.id === 1
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
      const responses: unknown[] = lines
        .map((line) => {
          try {
            return JSON.parse(line) as unknown;
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const initResponse = responses.find(
        (r): r is JsonRpcResponse => isJsonRpcResponse(r) && r.id === 1
      );
      expect(initResponse).toBeDefined();
      if (initResponse && initResponse.result && typeof initResponse.result === 'object') {
        const result = initResponse.result;
        if (
          'serverInfo' in result &&
          typeof result.serverInfo === 'object' &&
          result.serverInfo !== null
        ) {
          const serverInfo = result.serverInfo as Record<string, unknown>;
          expect(serverInfo.name).toBe('plane-mcp');
        }
      }
    } finally {
      await transport.close();
    }
  }, 5000);
});
