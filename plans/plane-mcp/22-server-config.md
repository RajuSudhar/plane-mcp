# feat-server-config

Phase: 22 | Status: [ ] todo
Depends on: 16-secure-setup (reuses `src/secrets.ts`'s config-dir resolution), 21-context-docs (last committed phase; no code overlap)
Ref: `src/config.ts`, `types/config.ts`, `src/secrets.ts`, `docs/CODING-STANDARDS.md`, `CLAUDE.md`

## Goal

Introduce a validated, file-based `ServerConfig` — separate from the existing
env-var `AuthContext` — that resolves per-tool output-token limits with a
safe built-in default, with zero behavior change to any existing tool,
transport, or CLI path. Pure foundation: types, a Zod v4 `.strict()` schema,
a discovery-order loader, a JSON Schema generator, and a resolution helper.
No enforcement, no threading into `createServer`/`toolHandler`, no CLI
changes — those are Phase 23 and Phase 24.

## Problem

Behavioral tuning (per-tool output caps) does not belong in env vars
alongside secrets and deploy-time values (`PLANE_API_KEY`,
`PLANE_WORKSPACE_SLUG`, `PLANE_BASE_URL`, `PORT`) — env vars are one flat
namespace with no nesting, so a future per-tool setting would need an
unbounded number of ad hoc `PLANE_MCP_<TOOL>_<SETTING>` env vars. A small
JSON config file gives structured, nested, per-tool settings with the same
zero-config-required default behavior the rest of this server already
guarantees (every env var except the two auth fields has a safe default).

## In scope

- `types/config.ts` — add `ToolSettings` and `ServerConfig`. `AuthContext`
  and `EnvConfig` are unchanged.
- `src/config.ts` — add:
  - `toolSettingsSchema` / `serverConfigSchema` (Zod v4, `.strict()`)
  - `loadServerConfig(deps?)` — discovery, parse, validate, env override,
    default-fill
  - `resolveMaxOutputTokens(config, toolName)`
- `src/paths.ts` (new) — extract the config-directory resolution
  (`XDG_CONFIG_HOME` / `PLANE_MCP_CONFIG_DIR` / `~/.config/plane-mcp`)
  already private inside `src/secrets.ts` into a shared, exported
  `getConfigDir()`, so the new config-file loader and the existing
  credential-file fallback agree on one directory. `src/secrets.ts` is
  refactored to import it — zero behavior change (its own tests must pass
  unmodified).
- `scripts/generate-config-schema.ts` (new) — emits
  `plane-mcp.config.schema.json` from `serverConfigSchema` via Zod v4's
  native `z.toJSONSchema()`. No new dependency.
- `plane-mcp.config.schema.json` (new, generated, committed at repo root).
- `package.json` — new script `generate:config-schema`.
- `src/config.test.ts` — extend with `loadServerConfig` /
  `resolveMaxOutputTokens` coverage.
- `scripts/generate-config-schema.test.ts` (new) — drift guard: the
  committed schema file must equal the script's freshly generated output.

## Out of scope

- Wiring `ServerConfig` into `createServer`, `registerXTools`, or
  `toolHandler` — Phase 23.
- Any token counting, any dependency addition (`gpt-tokenizer`) — Phase 23.
- `plane-mcp init` scaffolding a config file, `-y` flag, `help` subcommand —
  Phase 24.
- README / `docs/SECURITY.md` / `CLAUDE.md` documentation of the feature —
  Phase 25 (this phase's own doc comments and inline code are sufficient
  for review; no user-facing docs describe a behavior that does not yet
  affect any tool).

## Design

### `types/config.ts`

```typescript
type AuthContext = {
  apiKey: string;
  workspaceSlug: string;
  baseUrl: string;
};

type EnvConfig = {
  PLANE_API_KEY: string;
  PLANE_WORKSPACE_SLUG: string;
  PLANE_BASE_URL: string;
  PORT: number;
};

// v1: exactly one field. Deliberately a standalone type (not inlined into
// ServerConfig) so a future field (e.g. a per-tool timeout) is additive —
// every existing config file and every existing ToolSettings value stays
// valid with no migration.
type ToolSettings = {
  maxOutputTokens?: number;
};

// `defaults` is always fully resolved by loadServerConfig (never partial,
// never absent) — callers never need an `?? FALLBACK` at the call site.
// `tools` is keyed by MCP tool name (e.g. "list_work_items"); an absent key
// means "use defaults" for that tool.
type ServerConfig = {
  defaults: ToolSettings;
  tools: Record<string, ToolSettings>;
};

export type { AuthContext, EnvConfig, ToolSettings, ServerConfig };
```

`types/index.ts` already re-exports `export type * from './config';` —
no change needed there.

### `src/paths.ts`

```typescript
import * as os from 'node:os';
import * as path from 'node:path';

// Shared by src/secrets.ts (credentials.json) and src/config.ts
// (config.json) — both live under the same plane-mcp config directory, and
// both must resolve it identically or a user setting PLANE_MCP_CONFIG_DIR
// once would split secrets and behavior config into two different places.
export function getConfigDir(): string {
  return (
    process.env.PLANE_MCP_CONFIG_DIR ??
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'plane-mcp')
  );
}
```

`src/secrets.ts`'s private `getConfigDir()` function is deleted; its two
call sites (`ensureConfigDir`, `getFileSecret`) import `getConfigDir` from
`./paths` instead. The resolved string is byte-identical to today's
(`process.env.PLANE_MCP_CONFIG_DIR ?? (XDG_CONFIG_HOME ?? homedir()/.config) + '/plane-mcp'`)
— confirmed by running the existing `src/secrets.test.ts` suite unmodified.

### `src/config.ts` additions

```typescript
import { z } from 'zod';
import * as path from 'node:path';
import { readFile as fsReadFile } from 'node:fs/promises';
import type { ServerConfig, ToolSettings } from '@types';
import { getConfigDir } from './paths';
import { log } from './logger';

const DEFAULT_MAX_OUTPUT_TOKENS = 25000;

// Mirrors types/config.ts's ToolSettings/ServerConfig shape exactly, so the
// value returned by a successful `.parse()` is structurally assignable to
// ServerConfig with no cast. `.strict()` on every object level means an
// unknown/misspelled key (e.g. "maxOutputTokns") is a validation error, not
// a silently ignored no-op.
const toolSettingsSchema = z
  .object({
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

const serverConfigSchema = z
  .object({
    // Allowed so `$schema": "..."` (editor IntelliSense / JSON Schema
    // validation) can sit in a real config file without tripping .strict();
    // never read for behavior.
    $schema: z.string().optional(),
    defaults: toolSettingsSchema.optional(),
    tools: z.record(z.string(), toolSettingsSchema).optional(),
  })
  .strict();

export type LoadServerConfigDeps = {
  readFile?: (filePath: string) => Promise<string>;
  fileExists?: (filePath: string) => Promise<boolean>;
};

const defaultFileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fsReadFile(filePath, 'utf-8');
    return true;
  } catch {
    return false;
  }
};

function formatConfigError(configPath: string, error: z.ZodError): string {
  return `Invalid plane-mcp config at ${configPath}:\n${z.prettifyError(error)}`;
}

async function resolveConfigPath(fileExists: (p: string) => Promise<boolean>): Promise<string | null> {
  const explicit = process.env.PLANE_MCP_CONFIG;
  if (explicit) {
    if (!path.isAbsolute(explicit)) {
      throw new Error(`PLANE_MCP_CONFIG must be an absolute path, got: ${explicit}`);
    }
    if (!(await fileExists(explicit))) {
      throw new Error(`PLANE_MCP_CONFIG points to a file that does not exist: ${explicit}`);
    }
    return explicit;
  }

  const cwdConfig = path.join(process.cwd(), 'plane-mcp.config.json');
  if (await fileExists(cwdConfig)) {
    return cwdConfig;
  }

  const xdgConfig = path.join(getConfigDir(), 'config.json');
  if (await fileExists(xdgConfig)) {
    return xdgConfig;
  }

  return null;
}

function resolveEnvOverride(): number | undefined {
  const raw = process.env.PLANE_MCP_MAX_OUTPUT_TOKENS;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`PLANE_MCP_MAX_OUTPUT_TOKENS must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

export async function loadServerConfig(deps?: LoadServerConfigDeps): Promise<ServerConfig> {
  const readFile = deps?.readFile ?? ((p: string) => fsReadFile(p, 'utf-8'));
  const fileExists = deps?.fileExists ?? defaultFileExists;

  const configPath = await resolveConfigPath(fileExists);

  let fileDefaults: ToolSettings = {};
  let fileTools: Record<string, ToolSettings> = {};

  if (configPath) {
    const raw = await readFile(configPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid JSON in plane-mcp config at ${configPath}: ${msg}`);
    }

    const result = serverConfigSchema.safeParse(parsed);
    if (!result.success) {
      log('error', 'Invalid server config', {
        operation: 'config_load',
        configPath,
      });
      throw new Error(formatConfigError(configPath, result.error));
    }

    fileDefaults = result.data.defaults ?? {};
    fileTools = result.data.tools ?? {};

    log('info', 'Server config loaded', { operation: 'config_load', configPath });
  } else {
    log('info', 'No server config file found; using built-in defaults', {
      operation: 'config_load',
    });
  }

  const envOverride = resolveEnvOverride();

  const resolved: ServerConfig = {
    defaults: {
      maxOutputTokens: envOverride ?? fileDefaults.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    },
    tools: fileTools,
  };

  return resolved;
}

export function resolveMaxOutputTokens(config: ServerConfig, toolName: string): number {
  return config.tools[toolName]?.maxOutputTokens ?? config.defaults.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

export { serverConfigSchema, DEFAULT_MAX_OUTPUT_TOKENS };
```

**Discovery order** (first match wins):

1. `PLANE_MCP_CONFIG` env var — must be an absolute path; if set and the
   file is missing, this is an error (explicit user intent must not
   silently fall through to a different file).
2. `./plane-mcp.config.json` (`process.cwd()`).
3. `getConfigDir()/config.json` (`~/.config/plane-mcp/config.json` by
   default, honoring `XDG_CONFIG_HOME` / `PLANE_MCP_CONFIG_DIR` — the exact
   same directory `src/secrets.ts` already uses for `credentials.json`).
4. None found → built-in defaults, no error. The feature works with zero
   config file present.

**Precedence once a value is known**: `PLANE_MCP_MAX_OUTPUT_TOKENS` env var
(if set) overrides `defaults.maxOutputTokens` from the file; the file's
`defaults.maxOutputTokens` overrides the built-in `25000`. `tools.<name>`
entries are read from the file only — there is no per-tool env var (that
would reopen the "unbounded env vars" problem this feature exists to avoid;
`PLANE_MCP_MAX_OUTPUT_TOKENS` is a single blunt global override for
CI/one-off use, not a per-tool mechanism).

**Why `.strict()` at every level**: a config author who misspells
`maxOutputTokens` (e.g. `maxOutputTkens`) must see a validation error at
startup, not have the typo silently ignored and the default silently used
— the entire point of a schema-validated config file is catching exactly
this class of mistake before it reaches a running server.

### `scripts/generate-config-schema.ts`

```typescript
#!/usr/bin/env bun
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { serverConfigSchema } from '../src/config';

const jsonSchema = z.toJSONSchema(serverConfigSchema, { target: 'draft-7' });

const output = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'plane-mcp server config',
  description:
    'Validated behavior config for plane-mcp: per-tool output-token limits. See https://github.com/RajuSudhar/plane-mcp for discovery order and defaults.',
  ...jsonSchema,
};

const target = new URL('../plane-mcp.config.schema.json', import.meta.url);
await writeFile(target, JSON.stringify(output, null, 2) + '\n');
```

`package.json` gains:

```json
"generate:config-schema": "bun run scripts/generate-config-schema.ts"
```

`plane-mcp.config.schema.json` is committed (not build-generated at
install time) so it ships in the npm tarball and resolves for a `$schema`
reference in a user's config file without requiring a local `bun run`
step. `scripts/generate-config-schema.test.ts` regenerates the schema
in-memory (importing the same `z.toJSONSchema(serverConfigSchema, ...)`
call) and asserts it deep-equals the parsed committed file — a drift
guard, so a future `ToolSettings` field change that forgets to re-run the
generator fails `bun test` instead of shipping a stale schema.

## Tasks

- [ ] Add `ToolSettings`, `ServerConfig` to `types/config.ts`
- [ ] Create `src/paths.ts` (`getConfigDir`); refactor `src/secrets.ts` to
      import it, delete the private duplicate
- [ ] Add `toolSettingsSchema`, `serverConfigSchema`, `loadServerConfig`,
      `resolveMaxOutputTokens`, `DEFAULT_MAX_OUTPUT_TOKENS` to
      `src/config.ts`
- [ ] Create `scripts/generate-config-schema.ts`; run it once to produce
      `plane-mcp.config.schema.json`; commit both
- [ ] Add `generate:config-schema` script to `package.json`
- [ ] Create `scripts/generate-config-schema.test.ts` (drift guard)
- [ ] Extend `src/config.test.ts`:
  - [ ] no config file anywhere → `loadServerConfig()` returns
        `{ defaults: { maxOutputTokens: 25000 }, tools: {} }`
  - [ ] `PLANE_MCP_CONFIG` (absolute, injected `readFile`/`fileExists`
        deps) is read and validated over the cwd/XDG paths
  - [ ] `PLANE_MCP_CONFIG` set to a non-existent path throws
  - [ ] `PLANE_MCP_CONFIG` set to a relative path throws
  - [ ] cwd `plane-mcp.config.json` used when `PLANE_MCP_CONFIG` unset
  - [ ] XDG/`~/.config/plane-mcp/config.json` used when neither of the
        above is present
  - [ ] unknown top-level key rejected with a path-precise error message
  - [ ] unknown key under `tools.<name>` rejected with a path-precise
        error message naming the tool
  - [ ] `$schema` key present in the file does not trigger a `.strict()`
        rejection
  - [ ] invalid JSON in the file throws with the file path in the message
  - [ ] `PLANE_MCP_MAX_OUTPUT_TOKENS` env var overrides the file's
        `defaults.maxOutputTokens`
  - [ ] `PLANE_MCP_MAX_OUTPUT_TOKENS` set to a non-positive-integer string
        throws
  - [ ] `resolveMaxOutputTokens` returns the per-tool value when present,
        else `defaults.maxOutputTokens`
  - [ ] `resolveMaxOutputTokens` never returns `undefined` (defaults is
        always fully resolved)
- [ ] Run `bun test` — all green, including unmodified `src/secrets.test.ts`
- [ ] Run `bun run typecheck` — passes
- [ ] Run `bun run check` — passes

## Definition of done

- [ ] `loadServerConfig()` is callable with zero config file present and
      returns a fully-resolved `ServerConfig`
- [ ] `.strict()` validation rejects unknown/misspelled keys with a
      precise path in the thrown error
- [ ] `plane-mcp.config.schema.json` exists, is generated from
      `serverConfigSchema` via `z.toJSONSchema()`, and matches the output
      of `scripts/generate-config-schema.ts` (drift-guarded by test)
- [ ] Zero call site outside `src/config.ts`, `src/paths.ts`,
      `scripts/generate-config-schema.ts`, and their tests changes in this
      phase — `createServer`, `toolHandler`, every `registerXTools`,
      `src/stdio.ts`, `src/index.ts`, `src/init.ts` are untouched
      (verified by re-running the full existing test suite unmodified and
      green)
- [ ] `docs/plans/TRACK.md` updated: Phase 22 row `[~]` at start, `[x]` at
      completion

## Open questions

- None — per-resource default field sets and enforcement wiring are
  Phase 23's concern, not this phase's.
