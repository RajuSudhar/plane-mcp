# feat-cli-config-help

Phase: 24 | Status: [ ] todo
Depends on: 22-server-config, 23-token-enforcement
Ref: `src/init.ts`, `src/stdio.ts`, `src/secrets.ts`, `src/paths.ts`,
`plans/plane-mcp/16-secure-setup.md`, `plans/plane-mcp/22-server-config.md`

## Goal

Extend `plane-mcp init` to scaffold a starter `plane-mcp.config.json`
alongside its existing keychain-secret flow, add a non-interactive `-y`
flag, and add a `help` subcommand (plus `--help`/`-h`) — all discoverable
from the CLI itself, with zero secrets ever written to the config file.

## In scope

- `src/init.ts`:
  - `parseArgs` gains `-y` (`yes: boolean`), `--config-path <path>`, and
    `--max-output-tokens <n>` flags.
  - `runInit` gains a config-scaffold step (after the existing
    secret-store step, before printing the MCP config JSON): resolves a
    target path (`--config-path`, else `~/.config/plane-mcp/config.json`),
    prompts for confirmation/override only when interactive and `-y` is
    not set, writes a starter file (with `$schema` +
    `defaults.maxOutputTokens`) if nothing already exists at that path
    (never overwrites), and adds `PLANE_MCP_CONFIG` to the printed MCP
    config's `env` block pointing at the resolved path.
  - End-of-init guidance block written to stderr: config file location,
    discovery order, how to add a per-tool override, the `$schema` field,
    and a pointer to `plane-mcp help`.
- `src/help.ts` (new) — `buildHelpText()` (pure, testable),
  `printHelp(write?)`.
- `src/help.test.ts` (new).
- `src/stdio.ts` — dispatcher recognizes `help` subcommand and `--help`/
  `-h` anywhere in argv, ahead of `init` and the default server path;
  dispatcher decision logic extracted into a small pure function so it is
  unit-testable without executing the top-level script's side effects.
- `src/stdio.test.ts` — dispatcher tests for the new `resolveCommand`
  export.
- `src/init.test.ts` — extended with scaffold/`-y`/`--config-path`/
  `--max-output-tokens` coverage.
- `types/init.ts` — `InitDeps` gains injectable deps for the new file-write
  step (`writeConfigFn`, `configFileExistsFn`), following the existing
  `setSecretFn`/`readKey`/`runCommand`/`write` DI pattern.

## Out of scope

- Any change to `loadServerConfig`'s discovery order or validation —
  Phase 22, unchanged.
- Any change to token-counting or enforcement — Phase 23, unchanged.
- README/CLAUDE.md/`docs/SECURITY.md` narrative documentation — Phase 25.
- Prompting to rotate or overwrite an existing config file — scaffolding
  is additive-only; a pre-existing file at the target path is left
  untouched and reported, never silently replaced.

## Design

### `types/init.ts`

```typescript
export type InitDeps = {
  setSecretFn?: (name: string, value: string) => Promise<void>;
  readKey?: () => Promise<string>;
  runCommand?: (cmd: string[]) => Promise<{ exitCode: number }>;
  write?: (s: string) => void;
  // New: injectable for the config-scaffold step, mirroring setSecretFn.
  writeConfigFn?: (path: string, contents: string) => Promise<void>;
  configFileExistsFn?: (path: string) => Promise<boolean>;
  // New: injectable confirmation prompt for the interactive, non -y path.
  confirmFn?: (question: string) => Promise<boolean>;
};
```

### `src/init.ts` — `parseArgs` additions

```typescript
type ParsedArgs = {
  name: string | null;
  workspace: string | null;
  baseUrl: string;
  port: number | null;
  key: string | null;
  register: boolean;
  yes: boolean;
  configPath: string | null;
  maxOutputTokens: number | null;
};
```

Parsing follows the existing flag-loop pattern exactly — a new branch per
flag (`-y` sets `result.yes = true` with no value consumed;
`--config-path`/`--max-output-tokens` consume the next arg like
`--base-url`/`--port` already do).

### Config scaffold step

```typescript
import { getConfigDir } from './paths';
import * as path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const CONFIG_SCHEMA_URL = 'https://raw.githubusercontent.com/RajuSudhar/plane-mcp/master/plane-mcp.config.schema.json';

function buildConfigScaffold(maxOutputTokens: number): string {
  const scaffold = {
    $schema: CONFIG_SCHEMA_URL,
    defaults: { maxOutputTokens },
    tools: {},
  };
  return JSON.stringify(scaffold, null, 2) + '\n';
}

async function defaultConfigFileExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

async function defaultWriteConfig(targetPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  await writeFile(targetPath, contents, { mode: 0o600 });
}

async function scaffoldConfig(
  parsed: ParsedArgs,
  deps: InitDeps,
  isInteractiveTTY: boolean
): Promise<{ path: string; created: boolean }> {
  const defaultPath = path.join(getConfigDir(), 'config.json');
  const configFileExists = deps.configFileExistsFn ?? defaultConfigFileExists;
  const writeConfig = deps.writeConfigFn ?? defaultWriteConfig;

  let targetPath = parsed.configPath ?? defaultPath;

  if (!parsed.yes && isInteractiveTTY && deps.confirmFn) {
    const proceed = await deps.confirmFn(`Create a starter config file at ${targetPath}? [Y/n] `);
    if (!proceed) {
      return { path: targetPath, created: false };
    }
  }

  if (await configFileExists(targetPath)) {
    return { path: targetPath, created: false };
  }

  const maxOutputTokens = parsed.maxOutputTokens ?? 25000;
  await writeConfig(targetPath, buildConfigScaffold(maxOutputTokens));
  return { path: targetPath, created: true };
}
```

**Never writes secrets**: `buildConfigScaffold` only ever emits `$schema`,
`defaults.maxOutputTokens`, and an empty `tools` object — there is no code
path from the API key (`apiKey`, `parsed.key`) into this function's
output. This is a structural guarantee (the function's only numeric input
is `maxOutputTokens`), not a runtime check, and is asserted directly in
tests (scaffold output never contains the test-injected secret value).

**Never overwrites**: `scaffoldConfig` returns `created: false` without
writing when a file already exists at the target path — `runInit` reports
this ("config already exists at `<path>`, left unchanged") rather than
silently clobbering a user's edited config.

**`-y` scope**: it skips only the new confirmation prompt this phase adds
(config-scaffold path/consent) and fills `maxOutputTokens` with `25000`
when `--max-output-tokens` isn't also passed. It does not affect the
existing API-key prompt (`--key` already covers non-interactive key input;
`-y` alone does not supply a key) or the `--workspace` requirement (still
mandatory, unrelated to config scaffolding).

### `runInit` integration

After the existing "Store the key" step and before "Print the config":

```typescript
const isInteractiveTTY = process.stdin.isTTY ?? false;
const scaffold = await scaffoldConfig(parsed, deps ?? {}, isInteractiveTTY);

env.PLANE_MCP_CONFIG = scaffold.path;

// ...existing config object build (now includes PLANE_MCP_CONFIG in env)...

write('Successfully stored API key. Add this to your MCP configuration:\n\n');
write(JSON.stringify(config, null, 2));
write('\n\n');

if (scaffold.created) {
  process.stderr.write(`Starter config written to ${scaffold.path}\n`);
} else {
  process.stderr.write(`Config already present at ${scaffold.path} (left unchanged)\n`);
}

process.stderr.write(
  '\nBehavior config (plane-mcp.config.json):\n' +
    `  Location: ${scaffold.path}\n` +
    '  Discovery order: PLANE_MCP_CONFIG env (absolute path) > ' +
    './plane-mcp.config.json (cwd) > ~/.config/plane-mcp/config.json\n' +
    '  Add a per-tool limit: {"tools": {"list_work_items": {"maxOutputTokens": 10000}}}\n' +
    `  $schema is set to ${CONFIG_SCHEMA_URL} for editor validation\n` +
    '  Run "plane-mcp help" for the full command/env reference.\n'
);
```

`PLANE_MCP_CONFIG` is added to the same `env` object already populated
with `PLANE_MCP_INSTANCE`/`PLANE_WORKSPACE_SLUG`/`PLANE_BASE_URL`/
(optional)`PORT`, so it appears in both the printed JSON block and (when
`--register` is passed) the `claude mcp add --env` invocation, mirroring
how every other env var in that block is already handled.

### `src/help.ts`

```typescript
export function buildHelpText(): string {
  return `plane-mcp — MCP server for Plane

Usage:
  plane-mcp                          Run the stdio MCP server (default)
  plane-mcp init <name> [options]    Store an API key and scaffold config
  plane-mcp help                     Show this help

init options:
  --workspace <slug>            Workspace slug (required)
  --base-url <url>              API base URL (default: https://api.plane.so)
  --port <port>                 Server port (default: 3000)
  --key <key>                   API key for scripted/CI use (visible in
                                 process list; interactive hidden prompt is
                                 the secure default)
  --register                    Auto-register with claude mcp add
  -y                             Skip config-scaffold prompts, use defaults
  --config-path <path>          Config file location (default:
                                 ~/.config/plane-mcp/config.json)
  --max-output-tokens <n>       Default per-tool output-token limit written
                                 to the scaffolded config (default: 25000)

Behavior config (plane-mcp.config.json):
  Discovery order: PLANE_MCP_CONFIG env (absolute path) >
  ./plane-mcp.config.json (cwd) > ~/.config/plane-mcp/config.json >
  built-in defaults (25000 tokens/tool)
  Shape: {"defaults": {"maxOutputTokens": N}, "tools": {"<tool_name>":
  {"maxOutputTokens": N}}}
  Env override: PLANE_MCP_MAX_OUTPUT_TOKENS overrides defaults.maxOutputTokens

Auth env vars:
  PLANE_API_KEY            Direct API key (CI/dev fallback, skips keychain)
  PLANE_MCP_INSTANCE       Named instance to resolve from the OS keychain
  PLANE_WORKSPACE_SLUG     Workspace identifier (required)
  PLANE_BASE_URL           API base URL (default: https://api.plane.so)
  PORT                     HTTP server port (default: 3000)

Run "plane-mcp init <name> --workspace <slug>" to get started.
`;
}

export function printHelp(write: (s: string) => void = (s) => process.stdout.write(s)): void {
  write(buildHelpText());
}
```

`printHelp` writes to **stdout** deliberately — this is an explicit,
one-shot informational request the process exits after, never the
long-running stdio server path that must keep stdout reserved for
JSON-RPC framing. This mirrors `runInit`'s existing use of `write`
(defaulting to `process.stdout.write`) for the printed MCP config block,
while status/log lines in both `runInit` and here still go to stderr.

### `src/stdio.ts` dispatcher

```typescript
export function resolveCommand(argv: string[]): { command: 'help' | 'init' | 'server'; rest: string[] } {
  const [subcommand, ...rest] = argv;

  if (subcommand === 'help' || argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', rest };
  }
  if (subcommand === 'init') {
    return { command: 'init', rest };
  }
  return { command: 'server', rest: argv };
}
```

```typescript
#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server';
import { loadAuthContext, loadServerConfig } from './config';
import { log } from './logger';
import { runInit } from './init';
import { printHelp } from './help';

export function resolveCommand(/* as above */) {
  /* ... */
}

const { command, rest } = resolveCommand(process.argv.slice(2));

if (command === 'help') {
  printHelp();
} else if (command === 'init') {
  await runInit(rest);
} else {
  const auth = await loadAuthContext();
  const config = await loadServerConfig();
  const server = createServer(auth, config);
  const transport = new StdioServerTransport();

  log('info', 'plane-mcp stdio server starting', { operation: 'server_init', transport: 'stdio' });

  await server.connect(transport);
}
```

`resolveCommand` is a pure function of `argv`, exported for direct unit
testing — the module-level `if`/`else if`/`else` block that follows it is
the only top-level side-effecting code, kept intentionally thin so it
needs no test double for `process.argv`/stdin/stdout beyond what
`src/stdio.test.ts` already exercises for the server path.

## Tasks

- [ ] Add `yes`, `configPath`, `maxOutputTokens` fields + parsing branches
      to `parseArgs` in `src/init.ts`
- [ ] Add `writeConfigFn`, `configFileExistsFn`, `confirmFn` to
      `types/init.ts`'s `InitDeps`
- [ ] Implement `buildConfigScaffold`, `scaffoldConfig`,
      `defaultConfigFileExists`, `defaultWriteConfig` in `src/init.ts`
- [ ] Wire the scaffold step + `PLANE_MCP_CONFIG` env entry +
      end-of-init guidance into `runInit`
- [ ] Create `src/help.ts` (`buildHelpText`, `printHelp`)
- [ ] Create `src/help.test.ts`:
  - [ ] output contains `init`, `-y`, `--config-path`,
        `--max-output-tokens`, `PLANE_MCP_CONFIG`, `PLANE_MCP_MAX_OUTPUT_TOKENS`,
        `help`
- [ ] Add `resolveCommand` to `src/stdio.ts`; rewire the top-level
      dispatcher to use it; add the `help`/`--help`/`-h` branch
- [ ] Extend `src/stdio.test.ts`:
  - [ ] `resolveCommand(['help'])` → `{ command: 'help', ... }`
  - [ ] `resolveCommand(['--help'])` → `'help'`
  - [ ] `resolveCommand(['init', '--help'])` → `'help'` (help wins over
        init)
  - [ ] `resolveCommand(['init', 'foo'])` → `{ command: 'init', rest: ['foo'] }`
  - [ ] `resolveCommand([])` → `{ command: 'server', rest: [] }`
  - [ ] existing `createServer(auth)` call site updated to
        `createServer(auth, config)` with a fixture `ServerConfig`
- [ ] Extend `src/init.test.ts`:
  - [ ] default run (no `-y`, no TTY in test) scaffolds a config file at
        the default path with `maxOutputTokens: 25000` and no `confirmFn`
        blocking (non-TTY path skips the prompt, matching the existing
        key-read TTY-detection pattern)
  - [ ] `--config-path <custom>` scaffolds at the custom path
  - [ ] `--max-output-tokens <n>` writes that value into the scaffold
  - [ ] scaffold output never contains the injected secret/API key value
  - [ ] a pre-existing file at the target path is left unchanged
        (`writeConfigFn` never called) and reported via stderr, not
        stdout
  - [ ] `PLANE_MCP_CONFIG` appears in the printed JSON `env` block with
        the resolved path
  - [ ] `-y` skips `confirmFn` even when injected (never called)
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes
- [ ] Run `bun run check` — passes

## Definition of done

- [ ] `plane-mcp init` scaffolds a starter config (never overwriting an
      existing one), records `PLANE_MCP_CONFIG` in the printed env block,
      and never writes the API key to the config file
- [ ] `-y` produces a fully non-interactive, default-filled run
- [ ] `plane-mcp help` / `--help` / `-h` (in any position) print CLI usage,
      config discovery order, and env-var reference to stdout without
      running the server
- [ ] `docs/plans/TRACK.md` updated: Phase 24 row `[~]` at start, `[x]` at
      completion

## Open questions

- None.
