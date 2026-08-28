import { spawn } from 'bun';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import type { CommandRunner, CommandResult } from '@types';
import { log } from './logger';
import { getConfigDir } from './paths';

const defaultRunner: CommandRunner = async (
  cmd: string[],
  input?: string
): Promise<CommandResult> => {
  const proc = spawn(cmd, {
    stdin: input !== undefined ? 'pipe' : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (input !== undefined && proc.stdin) {
    void proc.stdin.write(input);
    void proc.stdin.end();
  }

  const stdoutText = await new Response(proc.stdout).text();
  await proc.exited;

  return {
    stdout: stdoutText,
    exitCode: proc.exitCode ?? 1,
  };
};

function getAccountName(): string {
  return process.env.USER ?? os.userInfo().username;
}

async function ensureConfigDir(): Promise<string> {
  const configDir = getConfigDir();
  try {
    await mkdir(configDir, { recursive: true, mode: 0o700 });
  } catch {
    // Ignore errors; directory may already exist or we may lack permissions
  }
  return configDir;
}

async function getFileSecret(name: string): Promise<string | null> {
  try {
    const configDir = getConfigDir();
    const filePath = path.join(configDir, 'credentials.json');
    const contents = await readFile(filePath, 'utf-8');
    const data = JSON.parse(contents) as Record<string, string>;
    return data[name] ?? null;
  } catch {
    return null;
  }
}

async function setFileSecret(name: string, value: string): Promise<void> {
  const configDir = await ensureConfigDir();
  const filePath = path.join(configDir, 'credentials.json');

  let data: Record<string, string> = {};
  try {
    const contents = await readFile(filePath, 'utf-8');
    data = JSON.parse(contents) as Record<string, string>;
  } catch {
    // File doesn't exist or is invalid; start fresh
  }

  data[name] = value;
  const json = JSON.stringify(data);
  await writeFile(filePath, json, { mode: 0o600 });
  // Explicitly chmod to ensure 0o600
  try {
    await chmod(filePath, 0o600);
  } catch {
    // chmod may not be available or may fail; do not fail
  }
}

async function deleteFileSecret(name: string): Promise<void> {
  try {
    const configDir = getConfigDir();
    const filePath = path.join(configDir, 'credentials.json');

    let data: Record<string, string> = {};
    try {
      const contents = await readFile(filePath, 'utf-8');
      data = JSON.parse(contents) as Record<string, string>;
    } catch {
      return; // File doesn't exist, nothing to do
    }

    delete data[name];
    const json = JSON.stringify(data);
    await writeFile(filePath, json, { mode: 0o600 });
  } catch {
    // Ignore errors during deletion
  }
}

// Exposed for testing platform-specific command builders
type Platform = 'darwin' | 'linux' | 'windows';

export function buildDarwinSetCmd(
  name: string,
  value: string,
  account: string
): { cmd: string[]; input?: string } {
  const serviceLabel = `plane-mcp/${name}`;
  return {
    cmd: [
      'security',
      'add-generic-password',
      '-U',
      '-a',
      account,
      '-s',
      serviceLabel,
      '-w',
      value,
      '-T',
      '/usr/bin/security',
    ],
  };
}

export function buildLinuxSetCmd(name: string, value: string): { cmd: string[]; input: string } {
  return {
    cmd: [
      'secret-tool',
      'store',
      `--label=plane-mcp/${name}`,
      'service',
      'plane-mcp',
      'account',
      name,
    ],
    input: value,
  };
}

export function buildDarwinGetCmd(
  name: string,
  account: string
): { cmd: string[]; input?: string } {
  const serviceLabel = `plane-mcp/${name}`;
  return {
    cmd: ['security', 'find-generic-password', '-a', account, '-s', serviceLabel, '-w'],
  };
}

export function buildLinuxGetCmd(name: string): { cmd: string[]; input?: string } {
  return {
    cmd: ['secret-tool', 'lookup', 'service', 'plane-mcp', 'account', name],
  };
}

export function buildDarwinDeleteCmd(
  name: string,
  account: string
): { cmd: string[]; input?: string } {
  const serviceLabel = `plane-mcp/${name}`;
  return {
    cmd: ['security', 'delete-generic-password', '-a', account, '-s', serviceLabel],
  };
}

export function buildLinuxDeleteCmd(name: string): { cmd: string[]; input?: string } {
  return {
    cmd: ['secret-tool', 'clear', 'service', 'plane-mcp', 'account', name],
  };
}

export async function setSecret(
  name: string,
  value: string,
  runner: CommandRunner = defaultRunner,
  platform: Platform = process.platform as Platform
): Promise<void> {
  if (platform === 'darwin') {
    const account = getAccountName();
    const { cmd } = buildDarwinSetCmd(name, value, account);

    try {
      await runner(cmd);
      log('info', 'Secret stored via Keychain', {
        operation: 'setSecret',
        backend: 'darwin',
        name,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Failed to store secret via Keychain: ${errorMsg}`, {
        operation: 'setSecret',
        backend: 'darwin',
        name,
      });
      throw new Error(
        `Failed to store secret via Keychain (macOS security command): ${errorMsg}. Ensure you have permission to modify Keychain items, or set PLANE_API_KEY directly.`
      );
    }
  } else if (platform === 'linux') {
    const { cmd, input } = buildLinuxSetCmd(name, value);

    try {
      await runner(cmd, input);
      log('info', 'Secret stored via Secret Service', {
        operation: 'setSecret',
        backend: 'linux',
        name,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Failed to store secret via Secret Service: ${errorMsg}`, {
        operation: 'setSecret',
        backend: 'linux',
        name,
      });
      throw new Error(
        `Failed to store secret via Secret Service (secret-tool not found or failed): ${errorMsg}. Install libsecret (secret-tool), or set PLANE_API_KEY directly.`
      );
    }
  } else {
    // Fallback: file-based storage
    try {
      await setFileSecret(name, value);
      log('info', 'Secret stored via file fallback', {
        operation: 'setSecret',
        backend: 'file',
        name,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Failed to store secret via file fallback: ${errorMsg}`, {
        operation: 'setSecret',
        backend: 'file',
        name,
      });
      throw new Error(
        `Failed to store secret via file fallback (${getConfigDir()}): ${errorMsg}. Check directory permissions or set PLANE_API_KEY directly.`
      );
    }
  }
}

export async function getSecret(
  name: string,
  runner: CommandRunner = defaultRunner,
  platform: Platform = process.platform as Platform
): Promise<string | null> {
  if (platform === 'darwin') {
    const account = getAccountName();
    const { cmd } = buildDarwinGetCmd(name, account);

    try {
      const result = await runner(cmd);
      if (result.exitCode !== 0) {
        return null;
      }
      log('info', 'Secret retrieved via Keychain', {
        operation: 'getSecret',
        backend: 'darwin',
        name,
      });
      return result.stdout.trim();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Failed to retrieve secret via Keychain: ${errorMsg}`, {
        operation: 'getSecret',
        backend: 'darwin',
        name,
      });
      throw new Error(
        `Failed to retrieve secret via Keychain (macOS security command): ${errorMsg}. Ensure you have permission to access Keychain items, or set PLANE_API_KEY directly.`
      );
    }
  } else if (platform === 'linux') {
    const { cmd } = buildLinuxGetCmd(name);

    try {
      const result = await runner(cmd);
      if (result.exitCode !== 0) {
        return null;
      }
      log('info', 'Secret retrieved via Secret Service', {
        operation: 'getSecret',
        backend: 'linux',
        name,
      });
      return result.stdout.trim();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Failed to retrieve secret via Secret Service: ${errorMsg}`, {
        operation: 'getSecret',
        backend: 'linux',
        name,
      });
      throw new Error(
        `Failed to retrieve secret via Secret Service (secret-tool not found or failed): ${errorMsg}. Install libsecret (secret-tool), or set PLANE_API_KEY directly.`
      );
    }
  } else {
    // Fallback: file-based storage
    try {
      const secret = await getFileSecret(name);
      if (secret) {
        log('info', 'Secret retrieved via file fallback', {
          operation: 'getSecret',
          backend: 'file',
          name,
        });
      }
      return secret;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Failed to retrieve secret via file fallback: ${errorMsg}`, {
        operation: 'getSecret',
        backend: 'file',
        name,
      });
      throw new Error(
        `Failed to retrieve secret via file fallback (${getConfigDir()}): ${errorMsg}. Check directory permissions or set PLANE_API_KEY directly.`
      );
    }
  }
}

export async function deleteSecret(
  name: string,
  runner: CommandRunner = defaultRunner,
  platform: Platform = process.platform as Platform
): Promise<void> {
  if (platform === 'darwin') {
    const account = getAccountName();
    const { cmd } = buildDarwinDeleteCmd(name, account);

    try {
      const result = await runner(cmd);
      if (result.exitCode === 0) {
        log('info', 'Secret deleted via Keychain', {
          operation: 'deleteSecret',
          backend: 'darwin',
          name,
        });
      } else if (result.exitCode === 44) {
        // Exit code 44: item not found (treat as success/no-op)
        log('info', 'Secret deleted via Keychain (not found or already deleted)', {
          operation: 'deleteSecret',
          backend: 'darwin',
          name,
        });
      } else {
        // Other non-zero exit code: log error and throw
        log('error', `Failed to delete secret via Keychain (exit code ${result.exitCode})`, {
          operation: 'deleteSecret',
          backend: 'darwin',
          name,
        });
        throw new Error(
          `Failed to delete secret via Keychain: macOS security command exited with code ${result.exitCode}`
        );
      }
    } catch (error) {
      // If it's already a known error from above, rethrow
      if (error instanceof Error && error.message.includes('Failed to delete secret')) {
        throw error;
      }
      // Other unexpected errors
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Failed to delete secret via Keychain: ${errorMsg}`, {
        operation: 'deleteSecret',
        backend: 'darwin',
        name,
      });
      throw new Error(`Failed to delete secret via Keychain (macOS security command): ${errorMsg}`);
    }
  } else if (platform === 'linux') {
    const { cmd } = buildLinuxDeleteCmd(name);

    try {
      await runner(cmd);
      log('info', 'Secret deleted via Secret Service', {
        operation: 'deleteSecret',
        backend: 'linux',
        name,
      });
    } catch {
      // Ignore errors during deletion
      log('info', 'Secret deleted via Secret Service (not found or already deleted)', {
        operation: 'deleteSecret',
        backend: 'linux',
        name,
      });
    }
  } else {
    // Fallback: file-based deletion
    try {
      await deleteFileSecret(name);
      log('info', 'Secret deleted via file fallback', {
        operation: 'deleteSecret',
        backend: 'file',
        name,
      });
    } catch {
      // Ignore errors during deletion
      log('info', 'Secret deleted via file fallback (not found or already deleted)', {
        operation: 'deleteSecret',
        backend: 'file',
        name,
      });
    }
  }
}
