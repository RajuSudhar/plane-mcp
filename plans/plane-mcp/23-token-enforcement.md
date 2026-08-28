# feat-token-enforcement

Phase: 23 | Status: [ ] todo
Depends on: 22-server-config
Ref: `plans/plane-mcp/22-server-config.md`, `src/tools/register.ts`,
`src/server.ts`, `src/stdio.ts`, `src/index.ts`, `docs/SECURITY.md`,
`plans/plane-mcp/17-response-shaping.md`, `plans/plane-mcp/19-list-projections.md`,
`plans/plane-mcp/20-retrieve-shaping.md`

## Goal

Enforce Phase 22's `maxOutputTokens` limits with a reject-and-guide policy:
after a tool function returns a non-error result, count the tokens of the
actual outgoing payload; if it exceeds the resolved limit, discard the
result entirely and return a guidance error instead — never a truncated or
partial payload. Thread `ServerConfig` through `createServer` and every
`registerXTools`/`toolHandler` call site to make this possible.

## Problem

Phase 22 can resolve a limit but nothing consults it. Every tool's `content`
text is a full `JSON.stringify` of the response object, with no ceiling —
a `list_work_items` call against a large project can return a payload an
agent's context window cannot absorb, with no signal to the caller other
than a very large response. Truncating the JSON blindly (e.g. slicing the
serialized string) would return invalid/unparseable JSON, which is worse
than an error — so the policy is reject-and-guide, not truncate.

**Existing double-representation, flagged not fixed here**: every tool
(`src/tools/*.ts`, established in Phases 05-09) currently returns
`{ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }`
— the same object serialized twice into the outgoing payload. This phase's
counter must measure that real, doubled payload (per Design below) rather
than counting only one representation and silently under-estimating what
the client actually receives. Collapsing the duplication is a response-shape
change, not a counting change — it belongs with Phases 19/20
(list/retrieve projections), which already touch every tool's return
statement; **not** duplicated or partially fixed here. See "Coordination
with Phases 17/19/20" below.

## In scope

- `package.json` — add `gpt-tokenizer` (`4.0.0`, exact-pinned) as a
  dependency, following the `docs/SECURITY.md` dependency-add process.
- `docs/SECURITY.md` — record the new dependency: what it is, why (pure-JS,
  zero runtime deps, MIT, Bun-native, o200k_base encoding — no native
  bindings, no network calls, no telemetry), and the completed security
  check (compromised-package-list check, npm registry/GitHub review).
- `src/tools/token-count.ts` (new) — `countOutputTokens(result)`,
  `TOKEN_COUNT_MULTIPLIER`.
- `src/tools/token-count.test.ts` (new).
- `src/tools/register.ts` — `toolHandler` gains a `config: ServerConfig`
  parameter; post-success enforcement.
- `src/tools/register.test.ts` — updated call sites + new enforcement
  tests.
- `src/server.ts` — `createServer(auth, config)`; passes `config` into
  every `registerXTools` call.
- All 10 `src/tools/*.ts` files (`users`, `projects`, `work-items`,
  `comments`, `relations`, `states`, `labels`, `members`, `cycles`,
  `modules`) — `registerXTools` gains a `config: ServerConfig` parameter;
  every `toolHandler(...)` call site inside gains the `config` argument.
  **No individual tool function (`listProjects`, `createWorkItem`, etc.)
  changes** — enforcement lives entirely in the `toolHandler` wrapper, not
  in tool bodies.
- All 10 `src/tools/*.test.ts` files + `src/stdio.test.ts` — call sites
  updated to pass a `ServerConfig` (a small fixed test fixture) wherever
  `toolHandler`/`createServer` is invoked directly.
- `src/stdio.ts` — calls `loadServerConfig()`, passes into `createServer`.
- `src/index.ts` — calls `loadServerConfig()` once at startup, passes into
  the `createMcpHandler` factory's `createServer(auth)` call (which becomes
  `createServer(auth, config)`).
- `bun.lock` — regenerated, committed.

## Out of scope

- Collapsing the `content`/`structuredContent` double-representation —
  Phases 19/20 (flagged above; cross-referenced, not implemented here).
- `plane-mcp init` config scaffolding, `-y`, `help` — Phase 24.
- README/CLAUDE.md/config-example documentation — Phase 25.
- Any change to what data a tool fetches or returns on success — this
  phase only decides whether an already-produced result is delivered or
  replaced with a guidance error.

## Design

### `src/tools/token-count.ts`

```typescript
import { encode } from 'gpt-tokenizer/model/gpt-4o';
import type { ToolResult } from '@types';

// gpt-tokenizer's o200k_base (GPT-4o family) encoding undercounts actual
// Claude token usage by roughly 15-20% on typical JSON payloads (different
// tokenizer vocabulary/merge rules) — applying a fixed multiplier keeps the
// enforced limit conservative without maintaining a second, Claude-specific
// tokenizer dependency.
export const TOKEN_COUNT_MULTIPLIER = 1.2;

// Counts the tokens of the ACTUAL outgoing payload: every text part of
// `content` plus `structuredContent` if present, concatenated exactly as
// the MCP client receives them (both are sent — see register.ts). This
// deliberately does not deduplicate `content`/`structuredContent` even
// when they carry the same underlying object (today's every-tool
// behavior) — the counter must reflect what actually goes over the wire,
// not what an idealized single-representation payload would cost. See
// Phase 23 doc, "Coordination with Phases 17/19/20".
export function countOutputTokens(result: ToolResult): number {
  const textPayload = result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const structuredPayload = result.structuredContent ? JSON.stringify(result.structuredContent) : '';
  const payload = textPayload + structuredPayload;
  return Math.ceil(encode(payload).length * TOKEN_COUNT_MULTIPLIER);
}
```

**Implementation-time verification note**: `gpt-tokenizer@4.0.0`'s exact
subpath export for the o200k_base (GPT-4o) encoder must be confirmed
against the installed package's `package.json` `exports` map before this
import is wired — `gpt-tokenizer/model/gpt-4o` is the expected path based
on the package's documented per-model export layout, but is not verified
against a running install as part of this spec. If the confirmed path
differs, update only this one `import` line; the rest of the module is
unaffected.

### `src/tools/register.ts`

```typescript
import type { PlaneApi } from '@types';
import type { ToolResult, ToolHandler, ServerConfig } from '@types';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { PlaneApiError } from '../plane/errors';
import { log } from '../logger';
import { resolveMaxOutputTokens } from '../config';
import { countOutputTokens } from './token-count';

export const WORK_ITEM_ID_TOOLS = new Set([/* unchanged */]);

function buildTokenLimitGuidance(toolName: string, tokenCount: number, limit: number): string {
  return (
    `Tool "${toolName}" result was withheld: the response is an estimated ` +
    `${tokenCount} tokens, exceeding the configured limit of ${limit} for ` +
    `this tool. Narrow the request and try again — for example: pass ` +
    `fields to request specific fields instead of the full object, ` +
    `reduce per_page, filter list_work_items/search_work_items by ` +
    `module_id or cycle_id instead of scanning a whole project, or call ` +
    `retrieve_work_item_by_identifier for a single known item instead of ` +
    `listing or searching. Configure this limit via the ` +
    `PLANE_MCP_MAX_OUTPUT_TOKENS env var or a "${toolName}" entry under ` +
    `tools in your plane-mcp config file.`
  );
}

export function toolHandler<TArgs extends Record<string, unknown>>(
  toolName: string,
  client: PlaneApi,
  fn: ToolHandler<TArgs>,
  config: ServerConfig
): (args: unknown) => Promise<CallToolResult> {
  return async (args: unknown): Promise<CallToolResult> => {
    log('info', 'Executing tool', { operation: 'tool_execute', toolName });
    const startedAt = Date.now();
    try {
      const result: ToolResult = await fn(client, args as TArgs);

      if (result.isError) {
        // Already an error result — pass through unchanged, never counted
        // or reinterpreted as a token-limit rejection.
        return result;
      }

      const tokenCount = countOutputTokens(result);
      const limit = resolveMaxOutputTokens(config, toolName);

      if (tokenCount > limit) {
        log('warn', 'Tool output exceeded configured token limit; result withheld', {
          operation: 'tool_execute',
          toolName,
          tokenCount,
          limit,
        });
        return {
          content: [{ type: 'text', text: buildTokenLimitGuidance(toolName, tokenCount, limit) }],
          isError: true,
        };
      }

      log('info', 'Tool execution complete', {
        operation: 'tool_execute',
        toolName,
        durationMs: Date.now() - startedAt,
        tokenCount,
      });
      return result;
    } catch (err) {
      /* unchanged error-mapping branch */
    }
  };
}
```

**Never partial data**: on limit breach, the entire original `result` is
discarded — not truncated, not partially included. The returned
`CallToolResult` contains only the guidance text.

**Error results skip counting entirely**: an `isError: true` result (e.g. a
`PlaneApiError` mapped to a short error string) is always small and is
never itself a token-limit concern; checking `result.isError` first also
guarantees the token-limit guidance message can never itself be
re-evaluated against the limit (it is returned directly from the `if`
branch, bypassing the counting path).

### `src/server.ts`

```typescript
export function createServer(auth: AuthContext, config: ServerConfig): McpServer {
  const server = new McpServer({ name: 'plane-mcp', version: '0.1.0' });
  const client = new PlaneClient(auth);

  registerUserTools(server, client, config);
  registerProjectTools(server, client, config);
  registerWorkItemTools(server, client, config);
  registerCommentTools(server, client, config);
  registerRelationTools(server, client, config);
  registerStateTools(server, client, config);
  registerLabelTools(server, client, config);
  registerMemberTools(server, client, config);
  registerCycleTools(server, client, config);
  registerModuleTools(server, client, config);

  return server;
}
```

### Per-tool-file pattern (all 10 files)

Each `registerXTools` gains the parameter and forwards it; e.g.
`src/tools/projects.ts`:

```typescript
export function registerProjectTools(server: McpServer, client: PlaneApi, config: ServerConfig): void {
  server.registerTool(
    'list_projects',
    { description: /* unchanged */, inputSchema: listProjectsSchema },
    toolHandler('list_projects', client, listProjects, config)
  );

  server.registerTool(
    'retrieve_project',
    { description: /* unchanged */, inputSchema: retrieveProjectSchema },
    toolHandler('retrieve_project', client, retrieveProject, config)
  );
}
```

Every other of the 9 remaining `registerXTools` functions follows this
exact pattern — add the `config: ServerConfig` parameter, forward it as the
4th argument to every `toolHandler(...)` call already inside that function.
No other line in any of these 10 files changes.

### `src/stdio.ts`

```typescript
if (subcommand === 'init') {
  await runInit(rest);
} else {
  const auth = await loadAuthContext();
  const config = await loadServerConfig();
  const server = createServer(auth, config);
  /* transport connect unchanged */
}
```

### `src/index.ts`

```typescript
const auth = await loadAuthContext();
const port = loadPort();
const config = await loadServerConfig();

const app = createMcpHonoApp();
const mcpHandler = createMcpHandler((_ctx) => createServer(auth, config), {
  legacy: 'stateless',
});
/* rest unchanged */
```

`loadServerConfig()` is called once at process startup on both entry
points, exactly like `loadAuthContext()`/`loadPort()` — not per-request,
matching the existing "assembled once at startup" property this RFC
already locks in for `AuthContext`.

### Coordination with Phases 17/19/20

Phases 17 (`17-response-shaping.md`) and 19-20 (`19-list-projections.md`,
`20-retrieve-shaping.md`) are still `[ ]` todo as of this phase. They are
independent of this phase's config-loading and enforcement-wiring work,
but converge on the same files this phase edits (`src/server.ts`,
`src/tools/register.ts`, every `src/tools/*.ts` `registerXTools`
signature) via different, non-overlapping edits — 17/19/20 change what a
tool returns; this phase changes how many parameters `registerXTools`
takes and adds a post-processing step in `toolHandler`. Implementing both
concurrently against the same lines risks merge conflicts, not design
conflicts. See `plans/plane-mcp/00-rfc.md`'s build-order note (added by
this feature's RFC amendment) for the recommended sequencing.

Once Phases 19-20 land, default per-item field projection will shrink the
per-tool payload this phase measures, which will make the `25000`-token
default trip less often for `list_*`/`retrieve_*` tools — that is a
beneficial side effect requiring no change to this phase's counting logic
(it counts whatever payload a tool actually returns, whatever shape that
is). The content/structuredContent double-representation this phase
flagged is a separate concern: even after 19-20 project fields down, the
same projected object is still serialized twice into the outgoing
payload. Collapsing that duplication (e.g., omitting the JSON dump from
`content.text` when `structuredContent` is present and letting the client
read `structuredContent` alone) is explicitly out of scope for this phase
and is recorded as an open item for a future phase to pick up alongside
19-20's own return-statement changes.

## Tasks

- [ ] Security-check `gpt-tokenizer@4.0.0` per `docs/SECURITY.md` (verify
      against the compromised-package list, review npm registry page +
      GitHub repo, confirm zero runtime dependencies)
- [ ] Add `gpt-tokenizer@4.0.0` (exact-pinned) to `package.json`
      dependencies; run install; commit regenerated `bun.lock`
- [ ] Record the dependency addition + security check in
      `docs/SECURITY.md`
- [ ] Create `src/tools/token-count.ts`
- [ ] Create `src/tools/token-count.test.ts`:
  - [ ] counts `content` text alone when `structuredContent` is absent
  - [ ] counts `content` text plus `JSON.stringify(structuredContent)`
        when both present (the doubled-payload case — the common one
        today)
  - [ ] applies the `1.2` multiplier with `Math.ceil`
  - [ ] a known short string produces a stable, asserted token count
        (regression pin against the actual encoder output, not a mocked
        one)
- [ ] Update `src/tools/register.ts`: `toolHandler` gains `config` param,
      enforcement branch, guidance builder
- [ ] Update `src/tools/register.test.ts`:
  - [ ] existing 404-hint tests updated to pass a fixture `ServerConfig`
        (`{ defaults: { maxOutputTokens: 25000 }, tools: {} }`) as the 4th
        arg
  - [ ] a tool fn returning a large `ToolResult` with a low
        `maxOutputTokens` limit produces `isError: true` and guidance text
        naming the tool, the estimated count, and the limit
  - [ ] guidance text names at least `fields`, `per_page`, `module_id`/
        `cycle_id`, and `retrieve_work_item_by_identifier`
  - [ ] a tool fn returning a large `ToolResult` under the limit passes
        through unmodified
  - [ ] a tool fn returning `isError: true` with a payload larger than the
        limit is passed through unmodified (never re-wrapped, never
        counted)
  - [ ] per-tool `config.tools.<name>.maxOutputTokens` overrides
        `config.defaults.maxOutputTokens` for that tool only
- [ ] Update `src/server.ts`: `createServer(auth, config)`
- [ ] Update all 10 `src/tools/*.ts` files: `registerXTools` signature +
      every internal `toolHandler(...)` call site
- [ ] Update all 10 `src/tools/*.test.ts` files: any direct
      `registerXTools`/`toolHandler` call site gains the `config` argument
- [ ] Update `src/stdio.ts`, `src/stdio.test.ts` (`createServer(auth)` →
      `createServer(auth, config)`)
- [ ] Update `src/index.ts`
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes
- [ ] Run `bun run check` — passes

## Definition of done

- [ ] Every tool response passes through token counting before delivery;
      a breach discards the result and returns `isError: true` with
      guidance naming the tool, the estimated count, the limit, and at
      least three concrete narrowing options
- [ ] `isError: true` results are never counted or reinterpreted
- [ ] `createServer`, every `registerXTools`, and `toolHandler` take
      `ServerConfig` explicitly — no tool constructs or loads config
      itself
- [ ] `gpt-tokenizer@4.0.0` is exact-pinned, security-checked, and
      recorded in `docs/SECURITY.md`
- [ ] `docs/plans/TRACK.md` updated: Phase 23 row `[~]` at start, `[x]` at
      completion

## Open questions

- Collapsing the `content`/`structuredContent` double representation is
  flagged (see Design, "Coordination with Phases 17/19/20") but
  deliberately left for a future phase alongside 19-20's own
  return-statement rewrites, rather than this phase touching all 31
  tools' return statements twice.
