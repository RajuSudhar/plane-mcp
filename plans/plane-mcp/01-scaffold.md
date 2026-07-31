# feat-scaffold

Phase: 01 | Status: [x] planned
Depends on: none
Ref: `plans/plane-mcp/00-rfc.md`, `docs/CODING-STANDARDS.md`, `CLAUDE.md`

## Goal

Stand up the Bun/TypeScript project skeleton — package manifest, tsconfig,
directory layout, CI — so that an empty-but-valid codebase type-checks and
every later phase has a fixed foundation to build on.

## In scope

- `package.json` (name `plane-mcp`, `bin.plane-mcp -> ./src/index.ts`,
  scripts `dev`/`typecheck`/`test`/`start`).
- `tsconfig.json` (`noEmit: true`, `strict: true`, `@types`/`@types/*` path
  alias resolving to `types/`).
- `bunfig.toml`.
- Pinned, exact-version dependency installs (no ranges).
- `.github/workflows/ci.yml` — Bun-based CI (`bun install --frozen-lockfile`,
  `tsc --noEmit`, `bun test`).
- `src/index.ts` — shebang stub entrypoint (no server logic yet).
- `types/` directory with placeholder `index.ts` and empty per-domain files
  so the `@types` alias resolves from commit one.
- `src/logger.ts` — stderr-based structured logger per
  `docs/CODING-STANDARDS.md`.
- `.bun-version` already exists (`1.3.14`) — verify, do not recreate.
- `bun.lock` committed after install.

## Out of scope

- Formatter/linter setup, pre-commit hook (Phase 02).
- Any HTTP server, transport, or MCP registration (Phase 03).
- `PlaneClient` or any Plane API call (Phase 04).
- Any tool implementation (Phases 05-09).
- README.md / ARCHITECTURE.md content (Phase 10 — a stub `README.md` may
  exist from repo init but is not authored here).

## Design

### Directory layout after this phase

```
plane-mcp/
├── .bun-version                # exists — verify contents: 1.3.14
├── .gitignore                  # exists
├── bun.lock                    # created by `bun install`
├── bunfig.toml                 # new
├── package.json                # new
├── tsconfig.json                # new
├── src/
│   ├── index.ts                 # new — shebang stub
│   └── logger.ts                # new
├── types/
│   ├── index.ts                  # new — re-export barrel
│   ├── common.ts                  # new — empty placeholder export
│   ├── config.ts                  # new — empty placeholder export
│   ├── logger.ts                   # new — LogLevel, LogContext
│   ├── mcp.ts                       # new — empty placeholder export
│   └── plane.ts                      # new — empty placeholder export
└── .github/
    └── workflows/
        └── ci.yml                     # new
```

### `package.json`

```json
{
  "name": "plane-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "plane-mcp": "./src/index.ts"
  },
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "start": "bun run src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "2.0.0",
    "@modelcontextprotocol/hono": "2.0.0",
    "hono": "4.6.14",
    "zod": "4.0.0"
  },
  "devDependencies": {
    "@types/bun": "1.3.14",
    "typescript": "7.0.0"
  }
}
```

**IMPORTANT**: every version above is an exact pin (no `^`, no `~`), per
`docs/CODING-STANDARDS.md` § Dependency Management. `@modelcontextprotocol/
hono` and `hono` versions must be re-verified against what actually resolves
at install time in Phase 03 — if the published version differs from `2.0.0`/
`4.6.14`, update this table and `package.json` together, exact-pinned, before
proceeding. `@modelcontextprotocol/server` is locked at `2.0.0` per the RFC
and must not be substituted with `@modelcontextprotocol/sdk` (v1 — explicitly
rejected in `00-rfc.md`).

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun-types"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "baseUrl": ".",
    "paths": {
      "@types": ["types/index.ts"],
      "@types/*": ["types/*"]
    }
  },
  "include": ["src/**/*.ts", "types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**CRITICAL**: `noEmit: true` is non-negotiable — this is the only compile
gate (`bun run typecheck` = `tsc --noEmit`). Bun executes `.ts` files
natively; `tsc` never writes `.js`/`.d.ts`/`.map` output in this repo. If a
future phase needs a build step (it should not), that is a distinct RFC
decision, not an incidental tsconfig change.

### `bunfig.toml`

```toml
[install]
exact = true

[test]
root = "./src"
```

`exact = true` enforces that `bun add` writes exact versions into
`package.json` (belt-and-suspenders with manually pinning versions above).

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.14'
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun test
```

**IMPORTANT**: `--frozen-lockfile` ensures CI fails loudly if `bun.lock` is
out of sync with `package.json`, rather than silently re-resolving. No
`build`/`dist` step — there is nothing to build in a `noEmit` project.

### `src/index.ts` (shebang stub only — no server logic this phase)

```typescript
#!/usr/bin/env bun

import { log } from './logger';

log('info', 'plane-mcp scaffold: entrypoint stub, no server started yet', {
  operation: 'server_init',
});
```

This is intentionally inert. Phase 03 replaces the body with the actual
`Bun.serve` + Hono wiring; this phase only proves the file is executable
(`bun run start`) and type-checks.

### `src/logger.ts`

```typescript
import type { LogLevel, LogContext } from '@types/logger';

const REDACTED_KEYS = new Set(['apiKey', 'api_key', 'PLANE_API_KEY', 'authorization', 'Authorization']);

function redact(context: LogContext): LogContext {
  const result: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = REDACTED_KEYS.has(key) ? '[REDACTED]' : value;
  }
  return result;
}

export function log(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? redact(context) : {}),
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}
```

**CRITICAL**: never `console.log`/`console.info`/`process.stdout.write` for
log output — this server uses HTTP transport (not stdio), so stdout is not
protocol-reserved the way a stdio MCP server's would be, but the house rule
in `docs/CODING-STANDARDS.md` and `CLAUDE.md` is unconditional: all logging
goes through `log()` to stderr, no exceptions, so the code stays correct if a
stdio transport is ever added later.

### `types/logger.ts`

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  operation?: string;
  toolName?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  error?: string;
  [key: string]: unknown;
};
```

### `types/common.ts`, `types/config.ts`, `types/mcp.ts`, `types/plane.ts` (placeholders)

Each file this phase contains only a placeholder to make the barrel export
valid; real content is added in Phases 02/03/04+:

```typescript
// types/common.ts (placeholder — populated as needed by later phases)
export type Placeholder = never;
```

Repeat the same one-line placeholder pattern for `config.ts`, `mcp.ts`,
`plane.ts` (each with its own `Placeholder` type — do not import between
placeholder files).

### `types/index.ts`

```typescript
export type * from './plane';
export type * from './mcp';
export type * from './config';
export type * from './logger';
export type * from './common';
```

**Note**: `types/cache.ts` from the `docs/CODING-STANDARDS.md` example
directory listing is omitted — this project has no caching layer (see
`00-rfc.md` non-goals; caching was a pattern from the general house
standard doc, not a requirement of this RFC). Do not add `types/cache.ts`
unless a future phase introduces caching.

## Tasks

- [x] Verify `.bun-version` contains exactly `1.3.14`
- [x] Write `package.json` per the Design section above
- [x] Write `tsconfig.json` per the Design section above
- [x] Write `bunfig.toml` per the Design section above
- [x] Create `src/index.ts` shebang stub
- [x] Create `src/logger.ts`
- [x] Create `types/logger.ts`, `types/common.ts`, `types/config.ts`,
      `types/mcp.ts`, `types/plane.ts` (placeholders), `types/index.ts`
      (barrel)
- [x] Create `.github/workflows/ci.yml`
- [x] Run `bun install`, verify exact versions resolved, commit `bun.lock`
- [x] Run `bun run typecheck` — must pass with zero errors
- [x] Run `bun run start` — must execute `src/index.ts` and print one stderr
      JSON log line, no stdout output
- [x] Confirm no `.js`, `.d.ts`, or `.map` files exist anywhere in the repo
      after `bun install` + `tsc --noEmit`

**Note**: `src/index.test.ts` was added as a minimal test harness placeholder;
this is accepted as fulfilling the test infrastructure requirement for this
phase.

## Definition of done

- [x] `bun run typecheck` passes on the empty-but-valid skeleton
- [x] `bun test` runs (zero test files is acceptable this phase, but the
      command must exit 0, not error)
- [x] `logger.ts` in place and is the only logging surface in the codebase
- [x] CI workflow present and would pass if run
- [x] `docs/plans/TRACK.md` updated: Phase 01 row moved to `[~]` at start,
      `[x]` once all tasks above are checked

## Open questions

- Exact published versions of `@modelcontextprotocol/server`,
  `@modelcontextprotocol/hono`, and `hono` at implementation time may not
  match the placeholders above (`2.0.0`/`2.0.0`/`4.6.14`) — resolve against
  the real registry during this phase's `bun install` and update this file's
  Design section to match reality before marking done.
- `typescript@7.0.0` is specified as "TypeScript 7 stable" per locked
  decisions; if 7.0.0 is not yet published at implementation time, pin to
  the latest available 7.x stable release instead of falling back to 5.x —
  do not silently downgrade the major version.
