import { describe, it, expect, mock, afterEach } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, rmdir } from 'node:fs/promises';
import type { CommandRunner } from '@types';
import {
  setSecret,
  getSecret,
  deleteSecret,
  buildLinuxSetCmd,
  buildLinuxGetCmd,
  buildLinuxDeleteCmd,
} from './secrets';

// Helper to create a mock CommandRunner that tracks calls
function createMockRunner(): {
  runner: CommandRunner;
  calls: Array<{ cmd: string[]; input?: string }>;
  responses: Map<string, { stdout: string; exitCode: number }>;
} {
  const calls: Array<{ cmd: string[]; input?: string }> = [];
  const responses = new Map<string, { stdout: string; exitCode: number }>();

  const runner: CommandRunner = mock(
    async (cmd: string[], input?: string): Promise<{ stdout: string; exitCode: number }> => {
      calls.push({ cmd, input });
      const key = JSON.stringify({ cmd, input });
      const response = responses.get(key) ?? { stdout: '', exitCode: 0 };
      return response;
    }
  );

  return { runner, calls, responses };
}

describe('secrets module', () => {
  describe('darwin backend (macOS Keychain)', () => {
    it('setSecret builds correct security add-generic-password command', async () => {
      const { runner, calls, responses } = createMockRunner();
      const key = JSON.stringify({
        cmd: [
          'security',
          'add-generic-password',
          '-U',
          '-a',
          process.env.USER ?? os.userInfo().username,
          '-s',
          'plane-mcp/test-key',
          '-w',
          'test-secret-value',
          '-T',
          '/usr/bin/security',
        ],
        input: undefined,
      });
      responses.set(key, { stdout: '', exitCode: 0 });

      await setSecret('test-key', 'test-secret-value', runner);

      expect(calls.length).toBe(1);
      const call = calls[0];
      expect(call.cmd[0]).toBe('security');
      expect(call.cmd[1]).toBe('add-generic-password');
      expect(call.cmd[2]).toBe('-U');
      expect(call.cmd[3]).toBe('-a');
      expect(call.cmd[5]).toBe('-s');
      expect(call.cmd[6]).toBe('plane-mcp/test-key');
      expect(call.cmd[7]).toBe('-w');
      expect(call.cmd[8]).toBe('test-secret-value');
      expect(call.cmd[9]).toBe('-T');
      expect(call.cmd[10]).toBe('/usr/bin/security');
      expect(call.input).toBeUndefined();
    });

    it('getSecret builds correct security find-generic-password command and returns trimmed stdout', async () => {
      const { runner, calls, responses } = createMockRunner();
      const key = JSON.stringify({
        cmd: [
          'security',
          'find-generic-password',
          '-a',
          process.env.USER ?? os.userInfo().username,
          '-s',
          'plane-mcp/test-key',
          '-w',
        ],
        input: undefined,
      });
      responses.set(key, { stdout: '  my-secret-value\n  ', exitCode: 0 });

      const result = await getSecret('test-key', runner);

      expect(calls.length).toBe(1);
      const call = calls[0];
      expect(call.cmd[0]).toBe('security');
      expect(call.cmd[1]).toBe('find-generic-password');
      expect(call.cmd[2]).toBe('-a');
      expect(call.cmd[4]).toBe('-s');
      expect(call.cmd[5]).toBe('plane-mcp/test-key');
      expect(call.cmd[6]).toBe('-w');
      expect(result).toBe('my-secret-value');
    });

    it('getSecret returns null on exitCode non-zero', async () => {
      const { runner, responses } = createMockRunner();
      const key = JSON.stringify({
        cmd: [
          'security',
          'find-generic-password',
          '-a',
          process.env.USER ?? os.userInfo().username,
          '-s',
          'plane-mcp/unknown',
          '-w',
        ],
        input: undefined,
      });
      responses.set(key, { stdout: '', exitCode: 44 });

      const result = await getSecret('unknown', runner);

      expect(result).toBeNull();
    });

    it('deleteSecret builds correct security delete-generic-password command', async () => {
      const { runner, calls, responses } = createMockRunner();
      const key = JSON.stringify({
        cmd: [
          'security',
          'delete-generic-password',
          '-a',
          process.env.USER ?? os.userInfo().username,
          '-s',
          'plane-mcp/test-key',
        ],
        input: undefined,
      });
      responses.set(key, { stdout: '', exitCode: 0 });

      await deleteSecret('test-key', runner);

      expect(calls.length).toBe(1);
      const call = calls[0];
      expect(call.cmd[0]).toBe('security');
      expect(call.cmd[1]).toBe('delete-generic-password');
      expect(call.cmd[2]).toBe('-a');
      expect(call.cmd[4]).toBe('-s');
      expect(call.cmd[5]).toBe('plane-mcp/test-key');
    });
  });

  describe('linux backend (Secret Service)', () => {
    it('buildLinuxSetCmd builds correct secret-tool store command with stdin', () => {
      const { cmd, input } = buildLinuxSetCmd('test-key', 'test-secret-value');
      expect(cmd[0]).toBe('secret-tool');
      expect(cmd[1]).toBe('store');
      expect(cmd[2]).toBe('--label=plane-mcp/test-key');
      expect(cmd[3]).toBe('service');
      expect(cmd[4]).toBe('plane-mcp');
      expect(cmd[5]).toBe('account');
      expect(cmd[6]).toBe('test-key');
      expect(input).toBe('test-secret-value');
    });

    it('setSecret with linux platform builds and runs secret-tool store command', async () => {
      const { runner, calls, responses } = createMockRunner();
      const { cmd, input } = buildLinuxSetCmd('test-key', 'test-secret-value');
      const key = JSON.stringify({ cmd, input });
      responses.set(key, { stdout: '', exitCode: 0 });

      await setSecret('test-key', 'test-secret-value', runner, 'linux');

      expect(calls.length).toBe(1);
      const call = calls[0];
      expect(call.cmd[0]).toBe('secret-tool');
      expect(call.cmd[1]).toBe('store');
      expect(call.input).toBe('test-secret-value');
    });

    it('buildLinuxGetCmd builds correct secret-tool lookup command', () => {
      const { cmd } = buildLinuxGetCmd('test-key');
      expect(cmd[0]).toBe('secret-tool');
      expect(cmd[1]).toBe('lookup');
      expect(cmd[2]).toBe('service');
      expect(cmd[3]).toBe('plane-mcp');
      expect(cmd[4]).toBe('account');
      expect(cmd[5]).toBe('test-key');
    });

    it('getSecret with linux platform builds and runs secret-tool lookup command', async () => {
      const { runner, calls, responses } = createMockRunner();
      const { cmd } = buildLinuxGetCmd('test-key');
      const key = JSON.stringify({ cmd, input: undefined });
      responses.set(key, { stdout: 'my-secret-value\n', exitCode: 0 });

      const result = await getSecret('test-key', runner, 'linux');

      expect(calls.length).toBe(1);
      expect(result).toBe('my-secret-value');
    });

    it('getSecret with linux platform returns null on exitCode non-zero', async () => {
      const { runner, responses } = createMockRunner();
      const { cmd } = buildLinuxGetCmd('unknown');
      const key = JSON.stringify({ cmd, input: undefined });
      responses.set(key, { stdout: '', exitCode: 1 });

      const result = await getSecret('unknown', runner, 'linux');

      expect(result).toBeNull();
    });

    it('buildLinuxDeleteCmd builds correct secret-tool clear command', () => {
      const { cmd } = buildLinuxDeleteCmd('test-key');
      expect(cmd[0]).toBe('secret-tool');
      expect(cmd[1]).toBe('clear');
      expect(cmd[2]).toBe('service');
      expect(cmd[3]).toBe('plane-mcp');
      expect(cmd[4]).toBe('account');
      expect(cmd[5]).toBe('test-key');
    });

    it('deleteSecret with linux platform builds and runs secret-tool clear command', async () => {
      const { runner, calls, responses } = createMockRunner();
      const { cmd } = buildLinuxDeleteCmd('test-key');
      const key = JSON.stringify({ cmd, input: undefined });
      responses.set(key, { stdout: '', exitCode: 0 });

      await deleteSecret('test-key', runner, 'linux');

      expect(calls.length).toBe(1);
      expect(calls[0].cmd[0]).toBe('secret-tool');
    });
  });

  describe('file fallback backend', () => {
    let tempDir: string;

    // Helper to set up a temp directory for file-fallback tests
    async function setupTempDir(): Promise<string> {
      const baseTemp = os.tmpdir();
      const tempName = 'plane-mcp-test-' + Math.random().toString(36).substring(7);
      const dir = path.join(baseTemp, tempName);
      await mkdir(dir, { mode: 0o700 });
      // Set the environment variable so our secrets module uses this temp dir
      process.env.PLANE_MCP_CONFIG_DIR = dir;
      return dir;
    }

    // Helper to clean up the temp directory
    async function cleanupTempDir(dir: string): Promise<void> {
      try {
        const filePath = path.join(dir, 'credentials.json');
        // Try to remove the file
        try {
          await Bun.file(filePath).delete?.();
        } catch {
          // File might not exist; ignore
        }
        // Try to remove the directory
        try {
          await rmdir(dir);
        } catch {
          // Directory might not be empty; ignore
        }
      } catch {
        // Ignore cleanup errors
      }
      delete process.env.PLANE_MCP_CONFIG_DIR;
    }

    afterEach(async () => {
      if (tempDir) {
        await cleanupTempDir(tempDir);
      }
    });

    it('file fallback: setSecret and getSecret round-trip values', async () => {
      tempDir = await setupTempDir();

      await setSecret('instance-1', 'secret-value-1', undefined, 'windows');
      const retrieved = await getSecret('instance-1', undefined, 'windows');

      expect(retrieved).toBe('secret-value-1');
    });

    it('file fallback: multiple instances are independent', async () => {
      tempDir = await setupTempDir();

      await setSecret('instance-a', 'secret-a', undefined, 'windows');
      await setSecret('instance-b', 'secret-b', undefined, 'windows');

      const result_a = await getSecret('instance-a', undefined, 'windows');
      const result_b = await getSecret('instance-b', undefined, 'windows');

      expect(result_a).toBe('secret-a');
      expect(result_b).toBe('secret-b');
    });

    it('file fallback: getSecret returns null for unknown name', async () => {
      tempDir = await setupTempDir();

      const result = await getSecret('non-existent', undefined, 'windows');

      expect(result).toBeNull();
    });

    it('file fallback: deleteSecret removes entry', async () => {
      tempDir = await setupTempDir();

      await setSecret('to-delete', 'secret-value', undefined, 'windows');
      let retrieved = await getSecret('to-delete', undefined, 'windows');
      expect(retrieved).toBe('secret-value');

      await deleteSecret('to-delete', undefined, 'windows');
      retrieved = await getSecret('to-delete', undefined, 'windows');
      expect(retrieved).toBeNull();
    });

    it('file fallback: credentials file is created with 0o600 mode', async () => {
      tempDir = await setupTempDir();

      await setSecret('mode-test', 'value', undefined, 'windows');

      const filePath = path.join(tempDir, 'credentials.json');
      const file = Bun.file(filePath);
      const stat = await file.stat?.();

      expect(stat).toBeDefined();
      if (stat) {
        // Mode should be 0o600 (384 in decimal)
        // We check the permission bits: (stat.mode & 0o777) should be 0o600
        const permissions = stat.mode & 0o777;
        expect(permissions).toBe(0o600);
      }
    });
  });

  describe('secret value security', () => {
    it('darwin: secret value is passed via -w flag, not logged', async () => {
      const { calls } = createMockRunner();

      // Create a mock that will check command array contents
      const mockFn: CommandRunner = mock(
        async (cmd: string[]): Promise<{ stdout: string; exitCode: number }> => {
          calls.push({ cmd });
          return { stdout: '', exitCode: 0 };
        }
      );

      await setSecret('secure-key', 'this-is-secret', mockFn);

      expect(calls.length).toBe(1);
      const call = calls[0];
      // Verify the secret is in the command array (not logged separately)
      expect(call.cmd.includes('this-is-secret')).toBe(true);
    });

    it('linux: secret value is passed via stdin, not in argv', async () => {
      const { calls } = createMockRunner();

      const mockFn: CommandRunner = mock(
        async (cmd: string[], input?: string): Promise<{ stdout: string; exitCode: number }> => {
          calls.push({ cmd, input });
          return { stdout: '', exitCode: 0 };
        }
      );

      await setSecret('secure-key', 'this-is-secret', mockFn, 'linux');

      expect(calls.length).toBe(1);
      const call = calls[0];
      // Verify secret is NOT in argv (should be in input)
      expect(call.cmd.includes('this-is-secret')).toBe(false);
      expect(call.input).toBe('this-is-secret');
    });
  });
});
