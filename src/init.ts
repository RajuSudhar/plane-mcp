import { spawn } from 'bun';
import type { InitDeps } from '@types';
import { setSecret } from './secrets';
import { log } from './logger';

type ParsedArgs = {
  name: string | null;
  workspace: string | null;
  baseUrl: string;
  port: number | null;
  key: string | null;
  register: boolean;
};

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    name: null,
    workspace: null,
    baseUrl: 'https://api.plane.so',
    port: null,
    key: null,
    register: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--workspace') {
      i += 1;
      if (i < args.length) {
        result.workspace = args[i];
      }
      i += 1;
    } else if (arg === '--base-url') {
      i += 1;
      if (i < args.length) {
        result.baseUrl = args[i];
      }
      i += 1;
    } else if (arg === '--port') {
      i += 1;
      if (i < args.length) {
        const parsed = Number.parseInt(args[i], 10);
        if (!Number.isNaN(parsed)) {
          result.port = parsed;
        }
      }
      i += 1;
    } else if (arg === '--key') {
      i += 1;
      if (i < args.length) {
        result.key = args[i];
      }
      i += 1;
    } else if (arg === '--register') {
      result.register = true;
      i += 1;
    } else if (!arg.startsWith('-')) {
      if (!result.name) {
        result.name = arg;
      }
      i += 1;
    } else {
      i += 1;
    }
  }

  return result;
}

async function defaultReadKey(parsedKey: string | null): Promise<string> {
  // If --key was provided, return it immediately
  if (parsedKey !== null) {
    return parsedKey;
  }

  // Check if stdin is a TTY
  const isTTY = process.stdin.isTTY ?? false;

  if (!isTTY) {
    // Stdin is piped; read all of it
    const data = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
      };
      const onEnd = () => {
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('end', onEnd);
        process.stdin.removeListener('error', onError);
        process.stdin.pause();
        resolve(Buffer.concat(chunks));
      };
      const onError = (err: Error) => {
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('end', onEnd);
        process.stdin.removeListener('error', onError);
        process.stdin.pause();
        reject(err);
      };
      process.stdin.on('data', onData);
      process.stdin.on('end', onEnd);
      process.stdin.on('error', onError);
    });
    return data.toString('utf-8').trim();
  }

  // Interactive TTY prompt
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    // Unix: attempt stty, fall back to visible prompt on error
    try {
      const sttyOff = spawn(['stty', '-echo'], {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'pipe',
      });

      const sttyExited = await sttyOff.exited;
      if (sttyExited !== 0) {
        // stty not available; fall back to visible prompt
        return readVisiblePrompt();
      }

      // Now read the line
      process.stderr.write('Enter your Plane API key (input hidden, paste then press Enter): ');
      const line = await readSingleLine();

      // Re-enable echo (best effort)
      const sttyOn = spawn(['stty', 'echo'], {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'pipe',
      });

      await sttyOn.exited;
      process.stderr.write('\n');
      return line;
    } catch {
      // Fall back to visible prompt
      return readVisiblePrompt();
    }
  } else {
    // Windows: fall back to visible prompt with warning
    return readVisiblePrompt();
  }
}

function readVisiblePrompt(): Promise<string> {
  process.stderr.write('Warning: API key will be visible on screen. Press Enter after pasting.\n');

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      process.stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const nlIndex = buf.indexOf(0x0a);
      if (nlIndex !== -1) {
        cleanup();
        resolve(buf.subarray(0, nlIndex).toString('utf-8').trim());
      }
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf-8').trim());
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}

function readSingleLine(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      process.stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const nlIndex = buf.indexOf(0x0a);
      if (nlIndex !== -1) {
        cleanup();
        resolve(buf.subarray(0, nlIndex).toString('utf-8').trim());
      }
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf-8').trim());
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}

async function defaultRunCommand(cmd: string[]): Promise<{ exitCode: number }> {
  const proc = spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await proc.exited;
  return { exitCode: proc.exitCode ?? 1 };
}

export async function runInit(args: string[], deps?: InitDeps): Promise<void> {
  const parsed = parseArgs(args);

  // Validate required args
  if (!parsed.name) {
    process.stderr.write('Usage: plane-mcp init <name> --workspace <slug> [options]\n');
    process.stderr.write('Options:\n');
    process.stderr.write('  --workspace <slug>       Workspace slug (required)\n');
    process.stderr.write(
      '  --base-url <url>         API base URL (default: https://api.plane.so)\n'
    );
    process.stderr.write('  --port <port>            Server port (default: 3000)\n');
    process.stderr.write(
      '  --key <key>              API key for scripted/CI use (visible in process list; interactive hidden prompt is the secure default)\n'
    );
    process.stderr.write('  --register               Auto-register with claude mcp add\n');
    throw new Error('name is required');
  }

  if (!parsed.workspace) {
    process.stderr.write('Error: --workspace is required\n');
    throw new Error('--workspace is required');
  }

  const setSecretFn = deps?.setSecretFn ?? setSecret;
  const runCommand = deps?.runCommand ?? defaultRunCommand;
  const write = deps?.write ?? ((s) => process.stdout.write(s));

  // Read the API key
  // If --key was provided, use it directly; otherwise call the reader
  const apiKey = parsed.key ? parsed.key : await (deps?.readKey ?? (() => defaultReadKey(null)))();

  // Store the key
  await setSecretFn(parsed.name, apiKey);

  log('info', 'Secret stored', {
    operation: 'init',
    instance: parsed.name,
  });

  // Build the MCP server definition
  const serverName = `plane-${parsed.name}`;
  const env: Record<string, string> = {
    PLANE_MCP_INSTANCE: parsed.name,
    PLANE_WORKSPACE_SLUG: parsed.workspace,
    PLANE_BASE_URL: parsed.baseUrl,
  };

  if (parsed.port !== null) {
    env.PORT = String(parsed.port);
  }

  const config = {
    mcpServers: {
      [serverName]: {
        command: 'plane-mcp',
        args: [],
        env,
      },
    },
  };

  // Print the config
  write('Successfully stored API key. Add this to your MCP configuration:\n\n');
  write(JSON.stringify(config, null, 2));
  write('\n\n');

  // Note about keychain storage
  process.stderr.write('API key stored in OS keychain (instance: ' + parsed.name + ')\n');

  // If --register, run claude mcp add
  if (parsed.register) {
    try {
      const claudeArgs = [
        'claude',
        'mcp',
        'add',
        '--scope',
        'user',
        serverName,
        '--env',
        `PLANE_MCP_INSTANCE=${parsed.name}`,
        '--env',
        `PLANE_WORKSPACE_SLUG=${parsed.workspace}`,
        '--env',
        `PLANE_BASE_URL=${parsed.baseUrl}`,
      ];

      if (parsed.port !== null) {
        claudeArgs.push('--env', `PORT=${String(parsed.port)}`);
      }

      claudeArgs.push('--', 'plane-mcp');

      const result = await runCommand(claudeArgs);

      if (result.exitCode !== 0) {
        process.stderr.write(
          'Failed to register with claude mcp add. Register manually with the JSON above.\n'
        );
      } else {
        log('info', 'Registered with claude mcp add', {
          operation: 'init',
          instance: parsed.name,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log('warn', 'Failed to run claude mcp add: ' + msg, {
        operation: 'init',
        instance: parsed.name,
      });
      process.stderr.write(
        'Failed to register with claude mcp add. Register manually with the JSON above.\n'
      );
    }
  }
}
