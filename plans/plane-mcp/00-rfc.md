# RFC: plane-mcp — MCP server for Plane

Status: accepted (locked decisions below are constraints, not open for re-litigation)
Ref: `docs/plane-api-reference.md` (authoritative Plane API + MCP tool reference), `docs/CODING-STANDARDS.md`, `CLAUDE.md`

## Problem

Plane (`makeplane/plane`) is an open-source Jira-like ticket tool with a REST API
(`/api/v1/...`) but no first-party TypeScript MCP server scoped to core ticket
workflows. The official Python `plane-mcp-server` exposes 100+ tools across ~20
modules, four transports (stdio, HTTP+OAuth, HTTP+PAT, legacy SSE), and requires
Redis for OAuth/session state — appropriate for a general-purpose, multi-tenant
integration, but oversized for a single team wanting a local, TypeScript-native
MCP server that covers the ticket-workflow surface (projects, work items,
comments, relations, states, labels, members, cycles, modules) an LLM agent
actually composes in day-to-day usage (see spec report §10, "Common MCP
workflows").

We need a greenfield, Bun/TypeScript MCP server that:

- Wraps the subset of the Plane REST API needed for ticket CRUD, triage,
  collaboration, and sprint/module planning.
- Runs as a single local process bound to `127.0.0.1`, authenticated via a
  Personal/Workspace Access Token, no OAuth infrastructure.
- Is implementable and reviewable in 10 bounded phases with zero design
  decisions deferred to implementation time.

## Goals

- Ship exactly the 31 tools enumerated in the Tool Scope (below) — full
  parity with the read/write/list/search shape the spec report's official
  server exposes for those resources, nothing more.
- Single streamable-HTTP transport, stateless, one `/mcp` endpoint.
- One `PlaneClient` class as the sole boundary to Plane's REST API: header
  injection, cursor pagination passthrough, 429 handling, typed errors.
- Tools as pure functions of `(authContext, args) -> result` — no per-transport
  branching, no hidden global state.
- Correct handling of the write/read field-name asymmetry documented in spec
  report §7.1 (`state` vs `state_id`, `assignees` vs `assignee_ids`,
  `target_date` vs `due_date`).
- `bun test` unit coverage for every tool (mocked `PlaneClient`) and for the
  client itself (mocked `fetch`).
- Zero `.js` emitted or committed; `tsc --noEmit` is the only compile step.

## Non-goals

- OAuth 2.0 (bot-token or user-token flows), OAuth proxy, redirect URIs,
  scope negotiation. API-Key (PAT) auth only.
- Redis/Valkey — no session store, no token cache. Stateless transport means
  there is no server-side session to cache against.
- Webhooks (registration, HMAC verification, dedup).
- ~~stdio transport. HTTP-only.~~ **Amended in Phase 11** — stdio was added
  as a second, additive transport for local single-user install
  (`bun link` / command-launched MCP clients). This does not reopen the
  "stdio-only" alternative rejected below: HTTP remains the transport for
  the "one local server, multiple clients" shape this RFC locked in; stdio
  is for "one client subprocess-launches its own server instance." See the
  amendment note under Alternatives and `plans/plane-mcp/11-distribution.md`.
- SSE (legacy) transport.
- The other ~75 tools in the spec report's catalog: work item properties/
  types, worklogs, epics, milestones, initiatives, intake, pages, teamspaces,
  customers, stickies, IDP group sync, workspace/project feature toggles,
  attachments, links, activities. These are real Plane resources but out of
  scope for this server's ticket-workflow focus. Revisit in a future RFC if
  needed — do not silently expand scope inside a phase.
- ~~Multi-workspace / multi-tenant support. One `PLANE_WORKSPACE_SLUG` per
  server process.~~ **Amended in Phase 16 (2026-08-07).** The "one
  `PLANE_WORKSPACE_SLUG` per server process" constraint is unchanged — a
  single running server still binds to exactly one workspace via one
  `AuthContext`. What is relaxed is the framing of "single locally-hosted
  server" as necessarily meaning one server _installation_ per machine:
  a user now runs `plane-mcp init <name>` once per workspace to create
  multiple independent, named local installs (`plane-<name>` in the MCP
  client config, each with its own `PLANE_MCP_INSTANCE`), each still a
  single-workspace, single-token, locally-hosted process per the original
  design. This is not multi-tenant HTTP (no per-request header-based auth
  is added — see Proposed design's AuthContext section, unchanged); it is
  N independent single-tenant installs coexisting on one machine. See the
  amendment note under Alternatives and `plans/plane-mcp/16-secure-setup.md`.
- Auto-pagination inside `list_*` tools. Tools return the raw pagination
  envelope; the calling model drives cursor iteration (spec report §2.4).

## Proposed design

### Architecture

```
┌──────────────┐   streamable HTTP    ┌────────────────────────────────────────┐   HTTPS   ┌────────────────┐
│  MCP Client  │ ───────────────────► │  plane-mcp (Bun process, 127.0.0.1)    │ ────────► │  Plane Backend │
│ (Claude Code,│  POST /mcp           │                                        │  X-API-Key│  api.plane.so  │
│  Cursor, ...)│ ◄─────────────────── │  ┌──────────────────────────────────┐  │ ◄──────── │  or self-host  │
└──────────────┘   JSON-RPC response  │  │ Transport layer                  │  │           └────────────────┘
                                       │  │  Hono app (createMcpHonoApp)      │  │
                                       │  │  stateless: fresh server+transport│  │
                                       │  │  per request; health endpoint     │  │
                                       │  ├──────────────────────────────────┤  │
                                       │  │ Config / AuthContext             │  │
                                       │  │  env vars read once at startup   │  │
                                       │  ├──────────────────────────────────┤  │
                                       │  │ Tool registry (31 pure fns)      │  │
                                       │  │  (authContext, args) -> result   │  │
                                       │  ├──────────────────────────────────┤  │
                                       │  │ PlaneClient (one class)          │  │
                                       │  │  fetch + X-API-Key + pagination  │  │
                                       │  │  + 429 backoff + typed errors    │  │
                                       │  ├──────────────────────────────────┤  │
                                       │  │ types/ (shared, root-level)       │  │
                                       │  └──────────────────────────────────┘  │
                                       └────────────────────────────────────────┘
```

**Transport layer** — `@modelcontextprotocol/hono`'s `createMcpHonoApp(server,
{ stateless: true })` mounted on `Bun.serve` via `export { port, fetch: app.fetch
}`. Stateless means `sessionIdGenerator: undefined`; per the known
stateless-reuse bug, a fresh `McpServer` + transport instance is constructed
per incoming request rather than reused across requests. A `/health` endpoint
is separate from `/mcp` and does not go through MCP framing.

**AuthContext** — assembled exactly once at process startup from
`PLANE_API_KEY` (required), `PLANE_WORKSPACE_SLUG` (required), `PLANE_BASE_URL`
(optional, default `https://api.plane.so`), `PORT` (optional). No per-request
header-based auth (no multi-tenant HTTP+PAT header path from the spec report —
that pattern is for the official server's remote multi-user mode; this server
is single-workspace, single-token, locally hosted).

**Amended in Phase 16 (2026-08-07):** `PLANE_API_KEY` gains a second source.
Resolution order is now (1) `process.env.PLANE_API_KEY` if set — unchanged,
kept as the env/CI/dev-fallback path; else (2) if `process.env.PLANE_MCP_INSTANCE`
is set, the key is read from the OS-native credential store (macOS Keychain /
Linux Secret Service / Windows Credential Manager or file fallback), namespaced
`plane-mcp/<instance-name>`, written once by `plane-mcp init <name>`; else (3)
a clear startup error directing the user to `plane-mcp init <name>`. This does
not add a per-request auth path or change the "assembled once at process
startup" property — the key is still resolved once, before the first request,
into the same `AuthContext` shape. Full design: `plans/plane-mcp/16-secure-setup.md`.

**PlaneClient** — one class, constructed once from `AuthContext`, passed into
every tool call. Owns: base URL join, `X-API-Key` header injection, cursor
pagination passthrough (returns the raw envelope, does not auto-page), 429
detection + backoff via `X-RateLimit-Reset` (surfaced as a tool error after
retries are exhausted — never silently dropped), and typed error mapping
(`PlaneApiError` with status code + body).

**Tools** — pure functions `(authContext, args) -> result`. Each tool:
validates `args` via a `zod` v4 schema passed directly as `inputSchema` to
`registerTool`, calls `PlaneClient` methods, normalizes field-name asymmetry
(read-shape `state_id`/`assignee_ids`/`target_date` vs write-shape
`state`/`assignees`/`target_date`; note create/update body uses `target_date`
too — see Phase 06 Design for the exact mapping table), and returns
`{ content: [{ type: 'text', text }], structuredContent? }`. Tool functions
never touch `process.env`, never construct their own `PlaneClient`, and never
import a transport type.

**Amended in Phase 17, 19-21 (2026-08-15):** by default, every tool's response is
passed through a shared, allowlist-based projection helper
(`src/plane/select.ts`) before being serialized into `content`/
`structuredContent`. This does not reopen the "no auto-pagination, raw
envelope" Non-goal above — pagination envelope metadata (`next_cursor`,
`prev_cursor`, `next_page_results`, `prev_page_results`, `count`,
`total_pages`, `total_results`) is passed through unmodified; only the
_shape of each item_ inside `results[]` (or the item returned by a
`retrieve_*` tool) is reduced to a small, per-resource default field set.
Every affected tool gains three optional params — `fields` (array of extra
raw field names to merge into the default projection), `full` (boolean,
bypass projection and truncation entirely, restoring today's raw-object
behavior), and, for `retrieve_*` tools only, `max_description_chars`
(override the default long-text truncation length) — so the model can
always recover the untrimmed object when it needs to. This is a
response-shape-only change: no endpoint, request body, write path, or
`PlaneApi`/`PlaneClient` method signature is touched. Full rationale and
per-tool default field sets: `plans/plane-mcp/17-response-shaping.md`,
`plans/plane-mcp/19-list-projections.md` through
`plans/plane-mcp/21-context-docs.md`.

**Amended in Phase 18 (2026-08-15, same amendment as above):** two
confirmed correctness bugs in `list_work_items`/`search_work_items` against
the public Plane REST API (`/api/v1/...`, self-hosted Community) are fixed
ahead of the response-shaping work above, and the response-shaping phases
are resequenced around the fix. Bug 1: the public `/work-items/` list
endpoint only honors `cursor`, `per_page`, `order_by`, `expand`, `fields`,
`external_id`, `external_source` — the seven array filters
`list_work_items` previously comma-joined and sent (`assignee_ids`,
`state_ids`, `state_groups`, `priorities`, `label_ids`, `cycle_ids`,
`module_ids`) are silently ignored server-side; the call succeeds and
returns an unfiltered page with no signal that filtering did not happen.
Bug 2: `search_work_items`'s `.../work-items/search/?q=` endpoint 404s on
Community — Plane's native search requires a Pro-tier OpenSearch
integration this server's target deployment does not have. Neither bug was
previously identified; both are confirmed against a live instance, not
assumed from `docs/plane-api-reference.md` (which documents both as if
they worked — the same document whose §2.6 claim and line-243 path this
amendment corrects the assumption behind, without editing the document
itself, since it documents Plane's API, not this server).

Fix: `module_ids`/`cycle_ids` are replaced by singular `module_id`/
`cycle_id` params that route to Plane's already-confirmed-working
per-module/per-cycle work-items sub-endpoints (the same paths
`add_work_items_to_module`/`add_work_items_to_cycle` already POST/DELETE
against); the remaining five filters become client-side-only, applied in
this process over a bounded multi-page scan of the base `/work-items/`
endpoint (capped at `CLIENT_SIDE_SCAN_MAX_ITEMS`/`CLIENT_SIDE_SCAN_MAX_PAGES`
items/pages, surfaced to the caller as a `truncated` response field, never
silently incomplete); `search_work_items` is rewritten to the same
bounded-scan approach, matching `name`/`sequence_id` case-insensitively,
and no longer calls `/search/` at all. This does not reopen the
"auto-pagination inside `list_*` tools" Non-goal — the scan is bounded and
internal to a single tool call, not a general-purpose auto-pager, and the
tool still does not construct or interpret Plane's own opaque cursor
format on the caller's behalf for the unfiltered fast path, which is
unchanged. Full design: `plans/plane-mcp/18-work-item-endpoints.md`. This
inserts a new Phase 18 ahead of the original Phase 18-20 (now 19-21) — see
the amended Phase sketch below.

**Amended in Phases 22-25 (2026-08-28):** a validated, file-based
`ServerConfig` is added alongside `AuthContext`, deliberately separate
from it — `AuthContext` remains env-var-only (secrets/deploy values:
`PLANE_API_KEY`, `PLANE_WORKSPACE_SLUG`, `PLANE_BASE_URL`, `PORT`);
`ServerConfig` is a JSON file (behavior/tuning values: v1 ships exactly
one, `defaults.maxOutputTokens` plus an optional per-tool
`tools.<name>.maxOutputTokens` override), resolved by `loadServerConfig()`
(`src/config.ts`) via a fixed discovery order (`PLANE_MCP_CONFIG` absolute
path → `./plane-mcp.config.json` → `~/.config/plane-mcp/config.json` →
built-in defaults, zero config required) and validated with a Zod v4
`.strict()` schema so an unknown/misspelled key is a startup error, not a
silently-ignored no-op. Both entry points (`src/stdio.ts`, `src/index.ts`)
load it once at startup, exactly like `AuthContext`, and
`createServer(auth, config)` threads it into every `registerXTools` call
and into `toolHandler`, which now enforces the resolved limit:
`gpt-tokenizer@4.0.0` (pure-JS, o200k_base encoding, ×1.2 conservatism
multiplier for Claude's undercounted token ratio) counts the actual
outgoing payload (`content` text plus `structuredContent`, since both are
sent to the client) after a tool function returns a non-error result; a
breach discards the result entirely and returns a guidance error naming
the tool, the estimated count, the limit, and concrete narrowing options
— never a truncated payload. `plane-mcp init` gains a config-scaffold step
(never overwriting an existing file, never writing the API key into it), a
non-interactive `-y` flag, and the server gains a `plane-mcp help`
subcommand. This does not reopen any existing Non-goal — no OAuth, no
Redis, no per-request auth path is added; `ServerConfig` carries no
secret. It does flag, without fixing, a pre-existing property of every
tool's return statement (Phases 05-09): `content`/`structuredContent`
duplicate the same object into the outgoing payload, which the new token
counter must measure honestly rather than under-count; collapsing that
duplication is left to Phases 19-20 (which already touch every tool's
return statement) or a later phase, not this one. **Recommended build
order**: Phase 22 (pure addition, no existing call site touched) can land
independently at any time; Phase 23 changes the signature of
`createServer`, every `registerXTools`, and `toolHandler` — the same
seam Phases 17/19/20 (response shaping) converge on from a different
angle (return-statement shape, not signature) — so the two feature
lines should not be implemented concurrently against those files, though
either can go first; Phase 24 depends only on Phase 22's `getConfigDir`/
config shape; Phase 25 is documentation-only and lands last. Full design:
`plans/plane-mcp/22-server-config.md` through
`plans/plane-mcp/25-config-docs.md`.

**types/** — root-level shared types per `docs/CODING-STANDARDS.md`:
`types/plane.ts` (wire shapes: WorkItem, Project, Cycle, Module, State, Label,
Comment, Relation, Member, PaginationEnvelope<T>), `types/mcp.ts` (ToolResult,
ToolContext), `types/config.ts` (AuthContext, EnvConfig, ToolSettings,
ServerConfig — the latter two added in Phase 22), `types/logger.ts`
(LogLevel, LogContext), `types/common.ts` (shared utility types), re-exported
from `types/index.ts`. Imported via the `@types` path alias.

### Tool scope (exactly 31 tools — locked)

`get_me`; `list_projects`, `retrieve_project`; `list_work_items`,
`retrieve_work_item`, `retrieve_work_item_by_identifier`, `create_work_item`,
`update_work_item`, `delete_work_item`, `search_work_items`;
`list_work_item_comments`, `create_work_item_comment`,
`update_work_item_comment`, `delete_work_item_comment`;
`list_work_item_relations`, `create_work_item_relation`,
`remove_work_item_relation`; `list_states`, `create_state`; `list_labels`,
`create_label`; `get_project_members`, `get_workspace_members`; `list_cycles`,
`create_cycle`, `add_work_items_to_cycle`, `remove_work_item_from_cycle`;
`list_modules`, `create_module`, `add_work_items_to_module`,
`remove_work_item_from_module`.

## Alternatives considered

### stdio-only transport — rejected

The spec report treats stdio as the default for local dev/IDE clients (env-var
auth, subprocess model). Rejected because: (1) the locked decision is a single
locally-hosted HTTP server so it can be reused across multiple client
processes and inspected independently of any one client's subprocess
lifecycle; (2) stdio ties the server's lifetime to the parent client process,
complicating the "one temporary `ping` tool to prove boot" verification step
in Phase 03; (3) streamable HTTP is the current MCP-spec-blessed transport
(spec report §1) and the one the locked decisions specify. stdio is not ruled
out forever, but adding it is a distinct future RFC, not a phase in this plan.

**Amendment (Phase 11, added post-hardening):** the "distinct future RFC"
condition above was resolved by decision rather than a new RFC: the user
wants a local, single-user MCP launchable by a `bunx`/command-style client
config (`mcpServers.<name>.command`) instead of an already-running HTTP
server a client points a URL at. That is additive, not a reversal of this
alternative's rejection — nothing here argued against stdio existing at
all, only against stdio being the _sole_ transport, which would have
broken the "one server, independently inspectable, reusable across
multiple client processes" property this RFC locked in. Phase 11
(`plans/plane-mcp/11-distribution.md`) adds `src/stdio.ts` as a second
entry point that reuses the same `createServer()`/`loadAuthContext()`
boundary the HTTP entry uses, so both transports serve an identically
tooled `McpServer`; the HTTP entry (`src/index.ts`) is untouched and
remains the multi-agent/multi-client transport. This closes the "revisit
in a future RFC" note above for the local-install use case specifically;
it does not reopen the Non-goals list beyond the one Non-goals line
amended to point here.

**Amendment (Phase 16, 2026-08-07):** the single-workspace, env-var-only auth
model this alternatives entry and the "Multi-workspace / multi-tenant
support" Non-goal both assumed is extended, not reversed, for secret storage
and multi-workspace local use: `plane-mcp init <name>` writes the API key to
an OS-native credential store once per named instance instead of requiring
it to live in the MCP client's env config, and multiple `init` runs produce
multiple independent single-workspace installs on one machine. Env-var auth
(`PLANE_API_KEY` set directly) remains fully supported as the CI/dev
fallback — nothing here removes it. No per-request or multi-tenant HTTP path
is added. Full design: `plans/plane-mcp/16-secure-setup.md`.

### Full 100+ tool scope (mirror the official server) — rejected

The spec report's catalog (§6) covers work item properties/types, worklogs,
epics, milestones, initiatives, intake, pages, teamspaces, customers,
stickies, IDP group sync, and full feature-toggle CRUD. Rejected because: (1)
the stated goal is a ticket-workflow-focused server, not a full Plane API
mirror; (2) each additional resource group adds a full CRUD surface, its own
zod schemas, its own field-asymmetry rules, and its own test suite —
multiplying phase count and review burden for tools with materially lower
usage frequency (per spec report §10's example workflows, the 31 selected
tools cover every listed workflow); (3) narrower scope is easier to keep at
100% test coverage, which is a stated Definition-of-Done bar for every phase.
Expanding scope later is additive (new phase files), not a rewrite, because
the tool-registration pattern (Phase 05) and `PlaneClient` (Phase 04) are
resource-agnostic.

### MCP SDK v1 (`@modelcontextprotocol/sdk`) — rejected

The spec report's reference implementation guide (§9.1) and TypeScript stack
recommendation both cite `@modelcontextprotocol/sdk` (v1-era package name).
Rejected in favor of `@modelcontextprotocol/server` v2 (`2.0.0`, pinned
exact) + `@modelcontextprotocol/hono` because: (1) v2 is the version targeted
by the locked decisions and ships the Hono-native `createMcpHonoApp` helper,
removing the need to hand-roll a streamable-HTTP adapter over the v1 SDK's
lower-level `StreamableHTTPServerTransport`; (2) v2's stateless mode
(`sessionIdGenerator: undefined`) is a first-class supported configuration,
whereas v1 stateless HTTP required more manual transport lifecycle
management; (3) staying off v1 avoids a migration once v2 is the maintained
line. Downside accepted: v2 is newer and less battle-tested than v1 — mitigated
by pinning the exact version and by Phase 03's explicit boot-verification
Definition of Done (server starts, `/mcp` responds to `initialize`, `ping`
returns `pong`) before any tool logic is built on top.

## Risks

| Risk                                                                                                                                                  | Mitigation                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stateless-per-request `McpServer` construction has a known reuse bug if servers/transports are cached across requests                                 | Phase 03 explicitly constructs a fresh `McpServer` + transport per request; this is a Definition-of-Done item, not an optimization to defer                                             |
| Field-name asymmetry (`state`/`state_id`, `assignees`/`assignee_ids`, `target_date`/`due_date`) is easy to get backwards in either direction          | Centralize normalization in `src/plane/normalize.ts` (Phase 04) with unit tests per direction (Phase 06); no tool hand-rolls its own mapping                                            |
| 429 responses silently swallowed by naive retry logic                                                                                                 | `PlaneClient` retry logic is unit-tested to assert it surfaces a tool error after backoff/retry exhaustion, never returns a partial/empty success (Phase 04 DoD)                        |
| `zod` v4 API surface for `inputSchema` (passing `z.object` directly vs `.shape`) may differ from `zod` v3 patterns in most existing examples          | Verify against `@modelcontextprotocol/server` v2's expected `inputSchema` shape during Phase 05's first vertical slice before repeating the pattern across Phases 06-09                 |
| Cursor pagination format (`value:offset:is_prev`) is opaque; a tool could be tempted to parse/construct it                                            | Tools pass `cursor` through as an opaquestring; only Plane constructs/interprets it — enforced by not exposing any cursor-math helper in `PlaneClient`                                  |
| `@modelcontextprotocol/server` v2 / `@modelcontextprotocol/hono` are newer packages; pinned exact versions may need bumping if a breaking patch ships | Exact-pin per `docs/CODING-STANDARDS.md`; any version bump is a reviewed dependency change, not an incidental upgrade                                                                   |
| Rate limit is workspace/key-wide (60 req/min per spec report §2.5); concurrent tool calls from one agent session could burn the budget fast           | Out of scope to build a client-side limiter in this plan; 429 surfacing (not swallowing) is the agreed-on mitigation — a limiter can be a future hardening item if observed in practice |

## Phase sketch

| Phase | File                        | Goal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01    | `01-scaffold.md`            | Bun/TypeScript project skeleton, pinned deps, CI, empty-but-valid typecheck pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 02    | `02-tooling.md`             | Formatting/linting baseline: Prettier as the single formatter for `.ts`/`.json`/`.md` (per-language overrides), oxlint linter for `.ts` correctness (`.oxlintrc.json`), committed pre-commit hook wired via `core.hooksPath`, CI gating, one-time full-repo baseline reformat                                                                                                                                                                                                                                                                                                                                                             |
| 03    | `03-transport.md`           | Stateless streamable-HTTP server on `/mcp`, health endpoint, `AuthContext` loader, temporary `ping` tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 04    | `04-plane-client.md`        | `PlaneClient` class: headers, pagination passthrough, 429 handling, typed errors, normalization helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 05    | `05-tools-foundation.md`    | Tool-registration pattern, zod v4 schemas, first vertical slice (`get_me`, `list_projects`, `retrieve_project`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 06    | `06-work-items.md`          | Work item CRUD + search + identifier lookup, field normalization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 07    | `07-collaboration.md`       | Comments CRUD, relations CRUD                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 08    | `08-workflow.md`            | States, labels, project/workspace members                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 09    | `09-sprints.md`             | Cycles + modules, including work-item join/unjoin tools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 10    | `10-hardening.md`           | README, ARCHITECTURE.md, final review pass, verify no `.js` emitted, full tool inventory check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 11    | `11-distribution.md`        | **Added post-hardening** (see Non-goals amendment + Alternatives amendment above): `src/stdio.ts` stdio transport entry point, `bun link`-installable `plane-mcp` bin, README local-MCP install section. HTTP transport unchanged.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 16    | `16-secure-setup.md`        | **Added post-Phase-15** (see Non-goals amendment + AuthContext amendment above): cross-platform OS-keychain secrets module (`src/secrets.ts`), `plane-mcp init <name>` CLI + `bin` dispatcher, `loadAuthContext` gains a keychain-backed resolution path keyed by `PLANE_MCP_INSTANCE`, multiple named local installs per workspace, Phase 15's macOS launchd artifacts relocated from repo-root `scripts/`/`deploy/` to `examples/macos-launchd/` as an optional add-on.                                                                                                                                                                 |
| 17    | `17-response-shaping.md`    | **Added post-Phase-16** (see Proposed design amendment above): shared allowlist-based projection/truncation helper (`src/plane/select.ts`, `types/select.ts`), `PlaneApi`/query-param groundwork for pushing a resolved `fields=` list down to Plane where already wired (projects, work items). No tool-facing behavior changes yet — foundation only.                                                                                                                                                                                                                                                                                   |
| 18    | `18-work-item-endpoints.md` | **Added 2026-08-15, ahead of the original Phase 18-20** (see Phase 18 amendment above): fixes two confirmed correctness bugs — `list_work_items`'s seven array filters silently dropped by Plane's public API, and `search_work_items`'s `/search/` endpoint 404ing on Community. `module_id`/`cycle_id` route to the real per-module/per-cycle work-items sub-endpoints; the remaining five filters and all of search become a bounded, capped client-side scan (`src/plane/paginate.ts`). Output stays raw/unprojected — Phase 19's projection step depends on this phase so filtering never runs against already-field-stripped items. |
| 19    | `19-list-projections.md`    | **Renumbered from the original Phase 18** (see Phase 18 amendment above). Apply minimal default per-item projections to every `list_*`/bulk/search tool (`list_projects`, `list_work_items`, `search_work_items`, `list_work_item_comments`, `get_project_members`, `get_workspace_members`, `list_states`, `list_labels`, `list_cycles`, `list_modules`); envelope/array wrapper untouched (including Phase 18's new scanned-result shape for `list_work_items`/`search_work_items`), `fields`/`full` opt-outs added.                                                                                                                    |
| 20    | `20-retrieve-shaping.md`    | **Renumbered from the original Phase 19**, otherwise unchanged. Apply fuller default projections + long-text truncation (`max_description_chars`) to `retrieve_work_item`, `retrieve_project`, `retrieve_work_item_by_identifier` (the last of which gains `fields`/`full`/`max_description_chars` params it previously lacked entirely).                                                                                                                                                                                                                                                                                                 |
| 21    | `21-context-docs.md`        | **Renumbered from the original Phase 20**, scope extended: update every touched tool's `description` string plus `README.md`/`docs/CODING-STANDARDS.md`/`CLAUDE.md` to document both the default-projection behavior (Phases 17, 19-20) and Phase 18's client-side filtering/search behavior + scan cap.                                                                                                                                                                                                                                                                                                                                  |
| 22    | `22-server-config.md`       | **Added post-Phase-21** (see Proposed design amendment above): file-based `ServerConfig` (`types/config.ts`), Zod v4 `.strict()` schema + discovery-order loader + JSON-Schema generator (`src/config.ts`, `scripts/generate-config-schema.ts`), `resolveMaxOutputTokens`, shared `getConfigDir` (`src/paths.ts`, extracted from `src/secrets.ts`). Pure foundation — no existing call site changes.                                                                                                                                                                                                                                      |
| 23    | `23-token-enforcement.md`   | **Added post-Phase-22**: `gpt-tokenizer@4.0.0` dependency, `src/tools/token-count.ts`, `ServerConfig` threaded through `createServer`/every `registerXTools`/`toolHandler`, reject-and-guide enforcement in `toolHandler` (discard-and-explain on breach, pass through unmodified under the limit or already-error). Flags, does not fix, the `content`/`structuredContent` double-representation for a future phase alongside 19-20.                                                                                                                                                                                                     |
| 24    | `24-cli-config-help.md`     | **Added post-Phase-23**: `plane-mcp init` gains a config-scaffold step (never overwrites, never writes secrets), `-y` non-interactive flag, `--config-path`/`--max-output-tokens` flags; new `plane-mcp help`/`--help`/`-h` subcommand (`src/help.ts`); `src/stdio.ts` dispatcher decision logic extracted into a testable `resolveCommand`.                                                                                                                                                                                                                                                                                              |
| 25    | `25-config-docs.md`         | **Added post-Phase-24**: `README.md` config section + example, `.env.example` additions, `CLAUDE.md` routing rows, repo-root example `plane-mcp.config.json`. Documentation only — `docs/SECURITY.md`'s `gpt-tokenizer` entry was already recorded in Phase 23.                                                                                                                                                                                                                                                                                                                                                                           |

Each phase file follows the `docs/plans/README.md` plan.md template (Phase,
Status, Depends on, Ref, Goal, In/Out of scope, Design, Tasks, Definition of
done, Open questions).
