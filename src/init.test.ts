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

  describe('config scaffold step', () => {
    it('scaffolds a config file at the default path with maxOutputTokens: 25000', async () => {
      const output: string[] = [];
      const stderrOutput: string[] = [];
      const configWrites: Array<{ path: string; contents: string }> = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (_s: string): boolean => {
        stderrOutput.push(_s);
        return true;
      };
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(['scaffold-test', '--workspace', 'test-ws'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
        });

        expect(configWrites.length).toBe(1);
        const { path: configPath, contents } = configWrites[0];
        expect(configPath).toContain('config.json');

        const parsed = JSON.parse(contents);
        expect(parsed.defaults.maxOutputTokens).toBe(25000);
        expect(parsed.$schema).toBeDefined();
        expect(parsed.tools).toBeDefined();

        // Check that config is not in stdout
        const fullOutput = output.join('');
        expect(fullOutput).not.toContain(contents);

        // Check that PLANE_MCP_CONFIG is in the env
        expect(fullOutput).toContain('PLANE_MCP_CONFIG');
        expect(fullOutput).toContain(configPath);
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('respects --config-path flag', async () => {
      const configWrites: Array<{ path: string; contents: string }> = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = () => {
        // no-op
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (): boolean => true;
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(
          [
            'custom-path-test',
            '--workspace',
            'test-ws',
            '--config-path',
            '/custom/path/config.json',
          ],
          {
            setSecretFn: mockSetSecret,
            readKey: async () => 'key',
            write: mockWrite,
            writeConfigFn: mockWriteConfig,
            configFileExistsFn: mockConfigFileExists,
          }
        );

        expect(configWrites.length).toBe(1);
        expect(configWrites[0].path).toBe('/custom/path/config.json');
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('respects --max-output-tokens flag', async () => {
      const configWrites: Array<{ path: string; contents: string }> = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = () => {
        // no-op
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (): boolean => true;
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(['token-test', '--workspace', 'test-ws', '--max-output-tokens', '50000'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
        });

        expect(configWrites.length).toBe(1);
        const { contents } = configWrites[0];
        const parsed = JSON.parse(contents);
        expect(parsed.defaults.maxOutputTokens).toBe(50000);
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('does not overwrite an existing config file', async () => {
      const configWrites: Array<{ path: string; contents: string }> = [];
      const output: string[] = [];
      const stderrOutput: string[] = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return true;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (_s: string): boolean => {
        stderrOutput.push(_s);
        return true;
      };
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(['existing-test', '--workspace', 'test-ws'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
        });

        // writeConfigFn should NOT be called
        expect(configWrites.length).toBe(0);

        // Check stderr message
        const stderrText = stderrOutput.join('');
        expect(stderrText).toContain('Config already present');
        expect(stderrText).toContain('left unchanged');
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('-y flag skips confirmFn even when injected', async () => {
      const configWrites: Array<{ path: string; contents: string }> = [];
      let confirmFnCalled = false;

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = () => {
        // no-op
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const mockConfirm = async () => {
        confirmFnCalled = true;
        return true;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (): boolean => true;
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(['yes-flag-test', '--workspace', 'test-ws', '-y'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
          confirmFn: mockConfirm,
        });

        // confirmFn should NOT be called when -y is used
        expect(confirmFnCalled).toBe(false);

        // Config should still be written
        expect(configWrites.length).toBe(1);
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('scaffold output never contains the API key', async () => {
      const configWrites: Array<{ path: string; contents: string }> = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = () => {
        // no-op
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (): boolean => true;
      process.stderr.write = mockStderrWrite;

      try {
        const secretKey = 'ultra-secret-key-xyz-123';

        await runInit(['secret-scaffold-test', '--workspace', 'test-ws'], {
          setSecretFn: mockSetSecret,
          readKey: async () => secretKey,
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
        });

        expect(configWrites.length).toBe(1);
        const { contents } = configWrites[0];
        expect(contents).not.toContain(secretKey);
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('PLANE_MCP_CONFIG appears in the printed JSON env block', async () => {
      const output: string[] = [];
      const configWrites: Array<{ path: string; contents: string }> = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (): boolean => true;
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(
          ['env-test', '--workspace', 'test-ws', '--config-path', '/test/config.json'],
          {
            setSecretFn: mockSetSecret,
            readKey: async () => 'key',
            write: mockWrite,
            writeConfigFn: mockWriteConfig,
            configFileExistsFn: mockConfigFileExists,
          }
        );

        const fullOutput = output.join('');
        const match = fullOutput.match(/\{[\s\S]*\}/);
        expect(match).toBeDefined();
        if (!match) {
          throw new Error('JSON not found in output');
        }
        const parsed = JSON.parse(match[0]);
        const env = parsed.mcpServers['plane-env-test'].env;

        expect(env.PLANE_MCP_CONFIG).toBe('/test/config.json');
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('prints guidance message to stderr', async () => {
      const stderrOutput: string[] = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = () => {
        // no-op
      };

      const mockWriteConfig = async () => {
        // no-op
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (_s: string): boolean => {
        stderrOutput.push(_s);
        return true;
      };
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(['guidance-test', '--workspace', 'test-ws'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
        });

        const stderrText = stderrOutput.join('');

        expect(stderrText).toContain('Behavior config');
        expect(stderrText).toContain('Location:');
        expect(stderrText).toContain('Discovery order:');
        expect(stderrText).toContain('plane-mcp.config.json');
        expect(stderrText).toContain('plane-mcp help');
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('confirmFn is called when isTTYFn returns true and -y is not passed', async () => {
      const configWrites: Array<{ path: string; contents: string }> = [];
      let confirmFnCalled = false;

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = () => {
        // no-op
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const mockConfirm = async () => {
        confirmFnCalled = true;
        return true;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (): boolean => true;
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(['confirm-test', '--workspace', 'test-ws'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
          confirmFn: mockConfirm,
          isTTYFn: () => true,
        });

        // confirmFn should be called when isTTYFn returns true
        expect(confirmFnCalled).toBe(true);

        // Config should be written since confirmFn returned true
        expect(configWrites.length).toBe(1);
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('confirmFn is not called and config not written when confirmFn returns false', async () => {
      const configWrites: Array<{ path: string; contents: string }> = [];
      const output: string[] = [];
      const stderrOutput: string[] = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return false;
      };

      const mockConfirm = async () => {
        return false;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (_s: string): boolean => {
        stderrOutput.push(_s);
        return true;
      };
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(['decline-test', '--workspace', 'test-ws'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
          confirmFn: mockConfirm,
          isTTYFn: () => true,
        });

        // Config should NOT be written
        expect(configWrites.length).toBe(0);

        // PLANE_MCP_CONFIG should NOT be in the env
        const fullOutput = output.join('');
        const match = fullOutput.match(/\{[\s\S]*\}/);
        expect(match).toBeDefined();
        if (!match) {
          throw new Error('JSON not found in output');
        }
        const parsed = JSON.parse(match[0]);
        const env = parsed.mcpServers['plane-decline-test'].env;

        expect(env.PLANE_MCP_CONFIG).toBeUndefined();

        // stderr should indicate config was skipped
        const stderrText = stderrOutput.join('');
        expect(stderrText).toContain('Config creation skipped');
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it('PLANE_MCP_CONFIG is set when file already exists', async () => {
      const configWrites: Array<{ path: string; contents: string }> = [];
      const output: string[] = [];

      const mockSetSecret = async () => {
        // no-op
      };

      const mockWrite = (s: string) => {
        output.push(s);
      };

      const mockWriteConfig = async (path: string, contents: string) => {
        configWrites.push({ path, contents });
      };

      const mockConfigFileExists = async () => {
        return true;
      };

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const mockStderrWrite = (): boolean => true;
      process.stderr.write = mockStderrWrite;

      try {
        await runInit(['existing-file-test', '--workspace', 'test-ws'], {
          setSecretFn: mockSetSecret,
          readKey: async () => 'key',
          write: mockWrite,
          writeConfigFn: mockWriteConfig,
          configFileExistsFn: mockConfigFileExists,
        });

        // Config should NOT be written (already exists)
        expect(configWrites.length).toBe(0);

        // PLANE_MCP_CONFIG should be in the env
        const fullOutput = output.join('');
        const match = fullOutput.match(/\{[\s\S]*\}/);
        expect(match).toBeDefined();
        if (!match) {
          throw new Error('JSON not found in output');
        }
        const parsed = JSON.parse(match[0]);
        const env = parsed.mcpServers['plane-existing-file-test'].env;

        expect(env.PLANE_MCP_CONFIG).toBeDefined();
        expect(env.PLANE_MCP_CONFIG).toContain('config.json');
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });
  });
});
