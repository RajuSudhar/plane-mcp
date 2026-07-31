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

- Ship exactly the ~25 tools enumerated in the Tool Scope (below) — full
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
- stdio transport. HTTP-only.
- SSE (legacy) transport.
- The other ~75 tools in the spec report's catalog: work item properties/
  types, worklogs, epics, milestones, initiatives, intake, pages, teamspaces,
  customers, stickies, IDP group sync, workspace/project feature toggles,
  attachments, links, activities. These are real Plane resources but out of
  scope for this server's ticket-workflow focus. Revisit in a future RFC if
  needed — do not silently expand scope inside a phase.
- Multi-workspace / multi-tenant support. One `PLANE_WORKSPACE_SLUG` per
  server process.
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
                                       │  │ Tool registry (~25 pure fns)     │  │
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

**types/** — root-level shared types per `docs/CODING-STANDARDS.md`:
`types/plane.ts` (wire shapes: WorkItem, Project, Cycle, Module, State, Label,
Comment, Relation, Member, PaginationEnvelope<T>), `types/mcp.ts` (ToolResult,
ToolContext), `types/config.ts` (AuthContext, EnvConfig), `types/logger.ts`
(LogLevel, LogContext), `types/common.ts` (shared utility types), re-exported
from `types/index.ts`. Imported via the `@types` path alias.

### Tool scope (exactly 25 tools — locked)

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

### Full 100+ tool scope (mirror the official server) — rejected

The spec report's catalog (§6) covers work item properties/types, worklogs,
epics, milestones, initiatives, intake, pages, teamspaces, customers,
stickies, IDP group sync, and full feature-toggle CRUD. Rejected because: (1)
the stated goal is a ticket-workflow-focused server, not a full Plane API
mirror; (2) each additional resource group adds a full CRUD surface, its own
zod schemas, its own field-asymmetry rules, and its own test suite —
multiplying phase count and review burden for tools with materially lower
usage frequency (per spec report §10's example workflows, the ~25 selected
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

| Risk | Mitigation |
| --- | --- |
| Stateless-per-request `McpServer` construction has a known reuse bug if servers/transports are cached across requests | Phase 03 explicitly constructs a fresh `McpServer` + transport per request; this is a Definition-of-Done item, not an optimization to defer |
| Field-name asymmetry (`state`/`state_id`, `assignees`/`assignee_ids`, `target_date`/`due_date`) is easy to get backwards in either direction | Centralize normalization in `src/plane/normalize.ts` (Phase 04) with unit tests per direction (Phase 06); no tool hand-rolls its own mapping |
| 429 responses silently swallowed by naive retry logic | `PlaneClient` retry logic is unit-tested to assert it surfaces a tool error after backoff/retry exhaustion, never returns a partial/empty success (Phase 04 DoD) |
| `zod` v4 API surface for `inputSchema` (passing `z.object` directly vs `.shape`) may differ from `zod` v3 patterns in most existing examples | Verify against `@modelcontextprotocol/server` v2's expected `inputSchema` shape during Phase 05's first vertical slice before repeating the pattern across Phases 06-09 |
| Cursor pagination format (`value:offset:is_prev`) is opaque; a tool could be tempted to parse/construct it | Tools pass `cursor` through as an opaquestring; only Plane constructs/interprets it — enforced by not exposing any cursor-math helper in `PlaneClient` |
| `@modelcontextprotocol/server` v2 / `@modelcontextprotocol/hono` are newer packages; pinned exact versions may need bumping if a breaking patch ships | Exact-pin per `docs/CODING-STANDARDS.md`; any version bump is a reviewed dependency change, not an incidental upgrade |
| Rate limit is workspace/key-wide (60 req/min per spec report §2.5); concurrent tool calls from one agent session could burn the budget fast | Out of scope to build a client-side limiter in this plan; 429 surfacing (not swallowing) is the agreed-on mitigation — a limiter can be a future hardening item if observed in practice |

## Phase sketch

| Phase | File | Goal |
| --- | --- | --- |
| 01 | `01-scaffold.md` | Bun/TypeScript project skeleton, pinned deps, CI, empty-but-valid typecheck pass |
| 02 | `02-tooling.md` | Formatting/linting baseline: Prettier as the single formatter for `.ts`/`.json`/`.md` (per-language overrides), ESLint flat config + typescript-eslint + `eslint-config-prettier` for `.ts` correctness, committed pre-commit hook wired via `core.hooksPath`, CI gating, one-time full-repo baseline reformat |
| 03 | `03-transport.md` | Stateless streamable-HTTP server on `/mcp`, health endpoint, `AuthContext` loader, temporary `ping` tool |
| 04 | `04-plane-client.md` | `PlaneClient` class: headers, pagination passthrough, 429 handling, typed errors, normalization helpers |
| 05 | `05-tools-foundation.md` | Tool-registration pattern, zod v4 schemas, first vertical slice (`get_me`, `list_projects`, `retrieve_project`) |
| 06 | `06-work-items.md` | Work item CRUD + search + identifier lookup, field normalization |
| 07 | `07-collaboration.md` | Comments CRUD, relations CRUD |
| 08 | `08-workflow.md` | States, labels, project/workspace members |
| 09 | `09-sprints.md` | Cycles + modules, including work-item join/unjoin tools |
| 10 | `10-hardening.md` | README, ARCHITECTURE.md, final review pass, verify no `.js` emitted, full tool inventory check |

Each phase file follows the `docs/plans/README.md` plan.md template (Phase,
Status, Depends on, Ref, Goal, In/Out of scope, Design, Tasks, Definition of
done, Open questions).
