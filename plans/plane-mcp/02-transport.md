# feat-transport

Phase: 02  |  Status: [ ] planned
Depends on: 01-scaffold
Ref: `plans/plane-mcp/00-rfc.md`, `../../../docs/plane-api-reference.md` §1, §5.1, §5.3

## Goal

Boot a stateless streamable-HTTP MCP server on `/mcp` with a separate health
endpoint, backed by an `AuthContext` assembled once from env vars, proven by
a single temporary `ping` tool.

## In scope

- `src/config.ts` — env var loader that builds and validates `AuthContext`
  at startup (fail fast on missing required vars).
- `types/config.ts` — real `AuthContext` and `EnvConfig` types (replacing the
  Phase 01 placeholder).
- `src/server.ts` — `McpServer` factory function (constructs a fresh server
  + registers tools every call — no module-level singleton).
- `src/index.ts` — replaces the Phase 01 stub: wires `Bun.serve`,
  `createMcpHonoApp`, `/health` route, `/mcp` route.
- One temporary `ping` tool (removed in Phase 04 once the real
  tool-registration pattern lands) that returns `pong`.
- Manual verification steps (curl-based) documented in Tasks.

## Out of scope

- `PlaneClient` (Phase 03) — `AuthContext` is assembled and validated for
  shape only; no live call to Plane's `/users/me/` yet.
- Real tool implementations (Phases 04-08) — `ping` is disposable scaffolding.
- Zod schema conventions for real tools (Phase 04 defines the pattern; `ping`
  may use a trivial inline schema).
- OAuth, SSE, stdio — all explicitly out of scope per `00-rfc.md`.

## Design

### `types/config.ts`

```typescript
export type AuthContext = {
  apiKey: string;
  workspaceSlug: string;
  baseUrl: string;
};

export type EnvConfig = {
  PLANE_API_KEY: string;
  PLANE_WORKSPACE_SLUG: string;
  PLANE_BASE_URL: string;
  PORT: number;
};
```

`AuthContext` has no optional fields — by the time it exists, all three
values are resolved (baseUrl defaulted if unset). There is no `bearer` /
OAuth variant per `00-rfc.md` non-goals — the spec report's `AuthContext`
shape (§9.4, `api_key` | `bearer`) is intentionally narrowed to API-Key-only.

### `src/config.ts`

```typescript
import type { AuthContext } from '@types/config';
import { log } from './logger';

const DEFAULT_BASE_URL = 'https://api.plane.so';
const DEFAULT_PORT = 3000;

export function loadAuthContext(): AuthContext {
  const apiKey = process.env.PLANE_API_KEY;
  const workspaceSlug = process.env.PLANE_WORKSPACE_SLUG;

  if (!apiKey) {
    log('error', 'Missing required env var', { operation: 'config_load', error: 'PLANE_API_KEY unset' });
    throw new Error('PLANE_API_KEY is required');
  }
  if (!workspaceSlug) {
    log('error', 'Missing required env var', { operation: 'config_load', error: 'PLANE_WORKSPACE_SLUG unset' });
    throw new Error('PLANE_WORKSPACE_SLUG is required');
  }

  const baseUrl = process.env.PLANE_BASE_URL ?? DEFAULT_BASE_URL;

  log('info', 'AuthContext loaded', { operation: 'config_load', workspaceSlug, baseUrl });

  return { apiKey, workspaceSlug, baseUrl };
}

export function loadPort(): number {
  const raw = process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`PORT must be a valid integer, got: ${raw}`);
  }
  return parsed;
}
```

**CRITICAL**: `log('info', ...)` above includes `workspaceSlug` and `baseUrl`
but never `apiKey` — confirm this at every future call site that logs
`AuthContext`-derived data. The `redact()` helper in `src/logger.ts` is a
backstop, not a substitute for not passing the key into `context` in the
first place.

### `src/server.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AuthContext } from '@types/config';

export function createServer(_auth: AuthContext): McpServer {
  const server = new McpServer({ name: 'plane-mcp', version: '0.1.0' });

  server.registerTool(
    'ping',
    {
      description: 'Temporary boot-verification tool. Removed once real tools land in Phase 04.',
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }),
  );

  return server;
}
```

`_auth` is accepted (not used yet) so the factory's signature already matches
what every later phase's tool registration will need — Phase 04 replaces the
`ping` registration with calls to each resource's `register*Tools(server,
auth)` function, and this factory becomes the single place that wires them
all together.

### `src/index.ts` (replaces Phase 01 stub)

```typescript
#!/usr/bin/env bun

import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { Hono } from 'hono';
import { createServer } from './server';
import { loadAuthContext, loadPort } from './config';
import { log } from './logger';

const auth = loadAuthContext();
const port = loadPort();

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route(
  '/mcp',
  createMcpHonoApp(() => createServer(auth), { stateless: true }),
);

log('info', 'plane-mcp server starting', { operation: 'server_init', port });

export default {
  port,
  hostname: '127.0.0.1',
  fetch: app.fetch,
};
```

**CRITICAL — stateless-reuse bug**: `createMcpHonoApp` must be given a
factory that produces a *new* `McpServer` (and therefore a new transport)
per request, not a shared singleton passed by reference. The signature above
passes `() => createServer(auth)` rather than `createServer(auth)` for
exactly this reason — confirm against the installed
`@modelcontextprotocol/hono` version's actual API at implementation time; if
that package expects the server instance directly (not a factory) instead,
the equivalent fix is to construct a brand-new `McpServer` inside the route
handler for every request rather than reusing one across requests. Whichever
shape the installed package requires, the *invariant* — fresh server +
transport per request — is the actual Definition-of-Done item, not the exact
call shown here.

`hostname: '127.0.0.1'` is required — locked decision is "single
locally-hosted server bound to 127.0.0.1", not `0.0.0.0`.

## Tasks

- [ ] Write `types/config.ts` (`AuthContext`, `EnvConfig`)
- [ ] Write `src/config.ts` (`loadAuthContext`, `loadPort`)
- [ ] Write `src/server.ts` (`createServer` factory + temporary `ping` tool)
- [ ] Replace `src/index.ts` stub with `Bun.serve`-compatible default export
      wiring `/health` and `/mcp`
- [ ] Verify `@modelcontextprotocol/hono`'s actual stateless API shape
      against installed version; adjust the factory-vs-instance call if the
      real API differs from the sketch above, while preserving the
      fresh-per-request invariant
- [ ] Manual boot test: `bun run start`, then `curl http://127.0.0.1:3000/health`
      returns `{"status":"ok"}`
- [ ] Manual MCP test: send an `initialize` JSON-RPC request to
      `http://127.0.0.1:3000/mcp`, confirm a valid MCP initialize response
- [ ] Manual tool test: call `ping` via the MCP client (or a raw JSON-RPC
      `tools/call` request), confirm response content is `pong`
- [ ] Confirm the server never binds to any interface other than `127.0.0.1`
- [ ] `bun run typecheck` passes

## Definition of done

- [ ] Server starts via `bun run start` with no unhandled errors
- [ ] `/mcp` responds to an MCP `initialize` request
- [ ] `ping` tool call returns `pong`
- [ ] `/health` responds `200` independent of `/mcp` state
- [ ] No `apiKey` value appears in any stderr log line during startup or a
      `ping` call (manually inspect logs)
- [ ] `docs/plans/TRACK.md` updated: Phase 02 row `[~]` at start, `[x]` at
      completion

## Open questions

- Exact shape of `createMcpHonoApp`'s stateless option and whether it takes
  a server instance or a factory function needs to be confirmed against the
  actual installed `@modelcontextprotocol/hono` API docs/types at
  implementation time — the sketch in Design is best-effort from the locked
  decisions' description ("create a fresh server+transport per request") and
  must be reconciled with the real function signature before this phase is
  marked done.
- Default `PORT` value (`3000` above) is not specified by the locked
  decisions — confirmed as a free implementation choice; change here if a
  different default is preferred, but document the choice in this file
  rather than picking silently at code-review time.
