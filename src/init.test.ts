import { describe, it, expect } from 'bun:test';
import { runInit } from './init';

describe('runInit', () => {
  describe('success: store + print config', () => {
    it('stores secret and prints config without key', async () => {
      const calls: Array<{ name: string; value: string }> = [];
      const output: string[] = [];

      const mockSetSecret = async (name: string, value: string) => {
        calls.push({ name, value });
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      await runInit(
        ['breeze', '--workspace', 'breezehq', '--base-url', 'https://plane.breezehq.dev'],
        {
          setSecretFn: mockSetSecret,
          readKey: async () => 'secret-key-123',
          write: mockWrite,
        }
      );

      // Assert setSecretFn was called correctly
      expect(calls.length).toBe(1);
      expect(calls[0].name).toBe('breeze');
      expect(calls[0].value).toBe('secret-key-123');

      // Combine output and check contents
      const fullOutput = output.join('');

      // Assert the config is printed and contains expected fields
      expect(fullOutput).toContain('plane-breeze');
      expect(fullOutput).toContain('PLANE_MCP_INSTANCE');
      expect(fullOutput).toContain('breeze');
      expect(fullOutput).toContain('breezehq');
      expect(fullOutput).toContain('https://plane.breezehq.dev');

      // Assert the API key is NOT in the output
      expect(fullOutput).not.toContain('secret-key-123');
    });
  });

  describe('--key flag', () => {
    it('uses the key from --key flag without reading stdin', async () => {
      const calls: Array<{ name: string; value: string }> = [];
      const output: string[] = [];

      const mockSetSecret = async (name: string, value: string) => {
        calls.push({ name, value });
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      const mockReadKey = async () => {
        throw new Error('readKey should not be called when --key is provided');
      };

      await runInit(['prod', '--workspace', 'prod-ws', '--key', 'flagged-key'], {
        setSecretFn: mockSetSecret,
        readKey: mockReadKey,
        write: mockWrite,
      });

      // Assert the flagged key was stored
      expect(calls.length).toBe(1);
      expect(calls[0].value).toBe('flagged-key');

      // Assert the flagged key does NOT appear in output
      const fullOutput = output.join('');
      expect(fullOutput).not.toContain('flagged-key');
    });
  });

  describe('--register flag', () => {
    it('calls runCommand with claude mcp add when --register is passed', async () => {
      const commands: string[][] = [];
      const output: string[] = [];

      const mockRunCommand = async (cmd: string[]) => {
        commands.push(cmd);
        return { exitCode: 0 };
      };

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      await runInit(['staging', '--workspace', 'staging-ws', '--register'], {
        setSecretFn: mockSetSecret,
        readKey: async () => 'test-key',
        runCommand: mockRunCommand,
        write: mockWrite,
      });

      // Assert runCommand was called
      expect(commands.length).toBe(1);
      const cmd = commands[0];

      // Assert claude mcp add is in the command
      expect(cmd.join(' ')).toContain('claude');
      expect(cmd.join(' ')).toContain('mcp');
      expect(cmd.join(' ')).toContain('add');

      // Assert server name and env vars are included
      expect(cmd.join(' ')).toContain('plane-staging');
      expect(cmd.join(' ')).toContain('PLANE_MCP_INSTANCE=staging');
      expect(cmd.join(' ')).toContain('PLANE_WORKSPACE_SLUG=staging-ws');

      // Assert the key is NOT in the command
      expect(cmd.join(' ')).not.toContain('test-key');
    });

    it('handles runCommand failure gracefully (exitCode 1)', async () => {
      const output: string[] = [];

      const mockRunCommand = async () => {
        return { exitCode: 1 };
      };

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      await runInit(['failing', '--workspace', 'test-ws', '--register'], {
        setSecretFn: mockSetSecret,
        readKey: async () => 'key',
        runCommand: mockRunCommand,
        write: mockWrite,
      });

      // Should not throw; should print config even on command failure
      const fullOutput = output.join('');
      expect(fullOutput).toContain('plane-failing');
    });
  });

  describe('--port flag', () => {
    it('includes PORT in env when --port is passed', async () => {
      const output: string[] = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      await runInit(['porttest', '--workspace', 'test-ws', '--port', '8080'], {
        setSecretFn: mockSetSecret,
        readKey: async () => 'key',
        write: mockWrite,
      });

      const fullOutput = output.join('');

      // Assert PORT is in the output
      expect(fullOutput).toContain('PORT');
      expect(fullOutput).toContain('8080');
    });

    it('excludes PORT from env when --port is not passed', async () => {
      const output: string[] = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      await runInit(['noport', '--workspace', 'test-ws'], {
        setSecretFn: mockSetSecret,
        readKey: async () => 'key',
        write: mockWrite,
      });

      const fullOutput = output.join('');

      // Assert PORT is NOT in the output
      expect(fullOutput).not.toContain('"PORT"');
    });
  });

  describe('argument validation', () => {
    it('throws when name is missing', async () => {
      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = () => {
        // no-op
      };

      try {
        await runInit(['--workspace', 'test-ws'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
        });

        expect(false).toBe(true); // Should have thrown
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        expect(msg).toContain('name is required');
      }
    });

    it('throws when --workspace is missing', async () => {
      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = () => {
        // no-op
      };

      try {
        await runInit(['myname'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
        });

        expect(false).toBe(true); // Should have thrown
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        expect(msg).toContain('--workspace is required');
      }
    });
  });

  describe('default base-url', () => {
    it('uses https://api.plane.so when --base-url is not provided', async () => {
      const output: string[] = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      await runInit(['default', '--workspace', 'test-ws'], {
        setSecretFn: mockSetSecret,
        readKey: async () => 'key',
        write: mockWrite,
      });

      const fullOutput = output.join('');
      expect(fullOutput).toContain('https://api.plane.so');
    });
  });

  describe('output does not contain secrets', () => {
    it('never includes the API key in stdout output', async () => {
      const output: string[] = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      const secretKey = 'super-secret-api-key-12345-abcde';

      await runInit(['secret-test', '--workspace', 'test-ws'], {
        setSecretFn: mockSetSecret,
        readKey: async () => secretKey,
        write: mockWrite,
      });

      const fullOutput = output.join('');
      expect(fullOutput).not.toContain(secretKey);
    });
  });
});
