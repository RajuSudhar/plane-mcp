# feat-tools-foundation

Phase: 05 | Status: [x] done
Depends on: 04-plane-client
Ref: `plans/plane-mcp/00-rfc.md`, `../../../docs/plane-api-reference.md` §5.1, §5.6, §5.7, §6.1, §6.2, §6.3

## Goal

Establish the tool-registration pattern (pure-function wrapper, error
mapping, zod v4 schemas) and prove it with the first vertical slice:
`get_me`, `list_projects`, `retrieve_project`. Remove the Phase 03 `ping`
tool.

## In scope

- `src/tools/register.ts` — generic wrapper: takes a pure `(auth, args) ->
result` function, a zod schema, and a tool name/description; returns the
  `registerTool`-compatible handler with error-to-`isError` mapping baked in.
- `types/mcp.ts` — `ToolResult`, `ToolContext` (really just `AuthContext` re-exported
  under a tool-facing name if useful), `ToolHandler<TArgs, TResult>`.
- `src/tools/users.ts` — `get_me`.
- `src/tools/projects.ts` — `list_projects`, `retrieve_project`.
- Update `src/server.ts` — remove `ping`, call new
  `registerUserTools(server, planeClient)` / `registerProjectTools(server,
planeClient)`.
- Update `src/index.ts` — construct one `PlaneClient` per created `McpServer`
  (see stateless note in Phase 03 — each request's fresh server gets a fresh
  client built from the shared `AuthContext`; the client itself is cheap to
  construct, holds no connection state).
- Unit tests for all three tools against a mocked `PlaneClient`.

## Out of scope

- Work item tools (Phase 06).
- Comments/relations (Phase 07).
- States/labels/members (Phase 08).
- Cycles/modules (Phase 09).

## Design

### Tool-registration pattern rationale

Per `00-rfc.md`, tools are pure functions `(authContext, args) -> result`.
`PlaneClient` is constructed from `authContext` once per request (Phase 03
already establishes fresh-server-per-request; this phase adds
fresh-client-per-request built from that same `authContext`). The wrapper in
`register.ts` exists so:

1. Every tool gets identical error handling (a thrown `PlaneApiError` /
   `PlaneRateLimitError` becomes `{ content: [...], isError: true }`, never
   an uncaught exception that crashes the request).
2. Every tool gets identical structured logging at start/success/error.
3. Zod validation happens in one place, consistently, before the pure
   function body runs.

### `types/mcp.ts`

```typescript
import type { PlaneClient } from '../src/plane/client';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type ToolHandler<TArgs> = (client: PlaneClient, args: TArgs) => Promise<ToolResult>;
```

**Note**: `PlaneClient` is imported from `src/plane/client.ts`, not
redefined in `types/`. `docs/CODING-STANDARDS.md` reserves `types/` for
shared data shapes, not classes — `PlaneClient` stays a runtime class in
`src/plane/`; only its type-level surface (if ever needed standalone) would
move to `types/`. Import as a relative path here since `types/` sits above
`src/`; adjust the relative depth if the final tool file location differs
(verify `../src/plane/client` resolves correctly given `types/mcp.ts`'s
actual path — it is a sibling of `src/`, so one level up then into `src`).

### `src/tools/register.ts`

```typescript
import type { z } from 'zod';
import type { PlaneClient } from '../plane/client';
import type { ToolResult } from '@types/mcp';
import { PlaneApiError } from '../plane/errors';
import { log } from '../logger';

export function toolHandler<TSchema extends z.ZodType>(
  toolName: string,
  client: PlaneClient,
  fn: (client: PlaneClient, args: z.infer<TSchema>) => Promise<ToolResult>
) {
  return async (args: z.infer<TSchema>): Promise<ToolResult> => {
    log('info', 'Executing tool', { operation: 'tool_execute', toolName });
    const startedAt = Date.now();
    try {
      const result = await fn(client, args);
      log('info', 'Tool execution complete', {
        operation: 'tool_execute',
        toolName,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      const message = err instanceof PlaneApiError ? err.message : 'Unexpected error';
      log('error', 'Tool execution error', {
        operation: 'tool_execute',
        toolName,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  };
}
```

**IMPORTANT**: for non-`PlaneApiError` exceptions the tool result text is
the generic `'Unexpected error'`, not the raw error message — avoids leaking
implementation detail (e.g. a stack trace fragment) to the model/user, while
`PlaneApiError`'s own `.message` (status + body) is safe and useful to
surface since it originates from Plane's own API response, not an internal
exception. `PlaneRateLimitError` extends `PlaneApiError` so it is included
in the safe-to-surface branch automatically.

### Per-resource tool file pattern (`src/tools/users.ts`)

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import { toolHandler } from './register';

export function registerUserTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'get_me',
    {
      description: "Return the authenticated user's profile.",
      inputSchema: z.object({}),
    },
    toolHandler('get_me', client, async (c) => {
      const me = await c.get(c.workspacePath('../users/me/'));
      return {
        content: [{ type: 'text', text: JSON.stringify(me) }],
        structuredContent: me as Record<string, unknown>,
      };
    })
  );
}
```

**IMPORTANT**: `get_me` hits `/api/v1/users/me/`, which is _not_
workspace-scoped (spec report §3.1). `client.workspacePath('../users/me/')`
is a workaround hack and must **not** be used — instead add a dedicated
non-workspace-scoped path builder. Correct version:

```typescript
// src/plane/client.ts addition (Phase 05 amends Phase 04's client.ts):
apiPath(sub: string): string {
  return `/api/v1/${sub.replace(/^\//, '')}`;
}
```

```typescript
// src/tools/users.ts corrected call:
const me = await c.get(c.apiPath('users/me/'));
```

Add `apiPath` to `PlaneClient` as part of this phase's tasks (a small,
additive change to the Phase 04 file) rather than routing every
non-workspace-scoped call through string hacks on `workspacePath`.

### `src/tools/projects.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { PaginationEnvelope, Project } from '@types/plane';
import { toolHandler } from './register';

const listProjectsSchema = z.object({
  cursor: z.string().optional(),
  per_page: z.number().int().min(1).max(100).optional(),
  fields: z.string().optional(),
  expand: z.string().optional(),
});

const retrieveProjectSchema = z.object({
  project_id: z.string(),
  fields: z.string().optional(),
  expand: z.string().optional(),
});

export function registerProjectTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_projects',
    {
      description: 'List projects in the configured workspace. Returns the raw pagination envelope.',
      inputSchema: listProjectsSchema,
    },
    toolHandler('list_projects', client, async (c, args) => {
      const envelope = await c.get<PaginationEnvelope<Project>>(c.workspacePath('projects/'), args);
      return { content: [{ type: 'text', text: JSON.stringify(envelope) }], structuredContent: envelope };
    })
  );

  server.registerTool(
    'retrieve_project',
    {
      description: 'Retrieve a single project by UUID.',
      inputSchema: retrieveProjectSchema,
    },
    toolHandler('retrieve_project', client, async (c, args) => {
      const { project_id, ...query } = args;
      const project = await c.get<Project>(c.workspacePath(`projects/${project_id}/`), query);
      return { content: [{ type: 'text', text: JSON.stringify(project) }], structuredContent: project };
    })
  );
}
```

**CRITICAL**: `inputSchema` is passed as the `z.object(...)` value directly
(per locked decisions: "pass z.object directly as inputSchema"), not
`.shape`, not wrapped again. Verify this is literally what
`@modelcontextprotocol/server` v2's `registerTool` expects at implementation
time — if the installed version expects the raw shape object
(`schema.shape`) instead of the `ZodObject` instance, adjust every tool file
consistently in this phase (it is a repeated pattern, fix it once here
before Phases 06-09 copy it forward).

### `src/server.ts` (updated — replaces `ping`)

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import type { AuthContext } from '@types/config';
import { PlaneClient } from './plane/client';
import { registerUserTools } from './tools/users';
import { registerProjectTools } from './tools/projects';

export function createServer(auth: AuthContext): McpServer {
  const server = new McpServer({ name: 'plane-mcp', version: '0.1.0' });
  const client = new PlaneClient(auth);

  registerUserTools(server, client);
  registerProjectTools(server, client);

  return server;
}
```

The Phase 03 `ping` registration is deleted entirely, not left dormant.

## Tasks

- [ ] Add `apiPath(sub: string): string` to `src/plane/client.ts`
      (non-workspace-scoped path builder)
- [ ] Write `types/mcp.ts` (`ToolResult`, `ToolHandler`)
- [ ] Write `src/tools/register.ts` (`toolHandler` wrapper)
- [ ] Write `src/tools/users.ts` (`get_me`, using `apiPath`)
- [ ] Write `src/tools/projects.ts` (`list_projects`, `retrieve_project`)
- [ ] Update `src/server.ts`: remove `ping`, wire the two new register
      functions
- [ ] Write `src/tools/users.test.ts` and `src/tools/projects.test.ts` against
      a mocked `PlaneClient` (mock at the `client.get`/`client.post` method
      level, not `fetch` — that layer is already covered in Phase 04)
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes
- [ ] Manually re-verify `/mcp` `initialize` still works and `ping` is gone
      (calling `ping` now returns an unknown-tool error)

## Definition of done

- [ ] `get_me`, `list_projects`, `retrieve_project` registered and callable
- [ ] Each tool has unit tests covering: success path (mocked client returns
      valid data), and error path (mocked client throws `PlaneApiError`,
      assert `isError: true` in the result)
- [ ] `list_projects` test asserts `cursor`/`per_page` are passed through to
      `client.get` untouched (no auto-paging logic introduced)
- [ ] `ping` tool fully removed from the codebase
- [ ] `docs/plans/TRACK.md` updated: Phase 05 row `[~]` at start, `[x]` at
      completion

## Open questions

- Whether `@modelcontextprotocol/server` v2's `registerTool` wants the
  `ZodObject` instance or `.shape` as `inputSchema` must be confirmed
  against the real installed package (see Design's `list_projects` note) —
  resolve once here, apply consistently to every subsequent phase's tool
  files.
- `structuredContent` typing above is loosely `Record<string, unknown>` cast
  from the resource type — if `@modelcontextprotocol/server` v2 has a
  stricter `structuredContent` type constraint, tighten this cast (or drop
  `structuredContent` in favor of `content`-only) during this phase rather
  than carrying an unverified cast into every later tool.
