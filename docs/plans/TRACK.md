# TRACK — Plane MCP

Last updated: 2026-07-28

## Status legend

[x] done [~] wip [ ] todo [!] blocked

## Phases

Plan docs: `plans/plane-mcp/00-rfc.md` (RFC) through `plans/plane-mcp/09-hardening.md`.

### Phase 00 — RFC

[x] `plans/plane-mcp/00-rfc.md` — problem, goals/non-goals, architecture, alternatives rejected (stdio-only, full 100+ tool scope, MCP SDK v1), risks, phase sketch

### Phase 01 — Scaffold

[x] `plans/plane-mcp/01-scaffold.md` — package.json, tsconfig, bunfig.toml, pinned deps, CI, src/index.ts stub, types/ dir, src/logger.ts

### Phase 02 — Transport

[ ] `plans/plane-mcp/02-transport.md` — stateless streamable-HTTP server on /mcp, health endpoint, AuthContext loader, McpServer factory, temporary ping tool

### Phase 03 — Plane Client

[ ] `plans/plane-mcp/03-plane-client.md` — PlaneClient class, pagination passthrough, 429 handling, typed errors, field-normalization helpers

### Phase 04 — Tools Foundation

[ ] `plans/plane-mcp/04-tools-foundation.md` — tool-registration pattern, zod v4 schemas, first vertical slice (get_me, list_projects, retrieve_project)

### Phase 05 — Work Items

[ ] `plans/plane-mcp/05-work-items.md` — list/retrieve/retrieve_by_identifier/create/update/delete/search work items, field normalization

### Phase 06 — Collaboration

[ ] `plans/plane-mcp/06-collaboration.md` — comments CRUD, relations CRUD (relation_type enum)

### Phase 07 — Workflow

[ ] `plans/plane-mcp/07-workflow.md` — states, labels, project/workspace members

### Phase 08 — Sprints

[ ] `plans/plane-mcp/08-sprints.md` — cycles + modules, work-item join/unjoin tools

### Phase 09 — Hardening

[ ] `plans/plane-mcp/09-hardening.md` — README.md, docs/ARCHITECTURE.md, final review, zero-.js verification, full tool inventory check

## Done

- Initial project bootstrap
- Process/docs layer established:
  - `docs/CODING-STANDARDS.md` (Bun/TypeScript 7 adapted)
  - `docs/BRANCH-MANAGEMENT.md` (8 branch types, naming policy)
  - `docs/SECURITY.md` (Bun context, PLANE_API_KEY protection)
  - `docs/plans/README.md` (plan.md template + TRACK.md sync rule)
  - `docs/plans/TRACK.md` (roadmap skeleton)
  - `CLAUDE.md` (routing doc + hard rules)
  - `.gitignore` (Bun-appropriate, commits bun.lock)
  - `.bun-version` (pinned to 1.3.14)
- RFC authored: `plans/plane-mcp/00-rfc.md` (architecture, alternatives, risks, phase sketch)
- Full phase plan authored: `plans/plane-mcp/01-scaffold.md` through `plans/plane-mcp/09-hardening.md`

## Decisions / deviations

1. **SDK + Validation**: MCP SDK v2 (`@modelcontextprotocol/server`, 2.0.0 exact) + `@modelcontextprotocol/hono` for transport, Zod v4 for runtime validation (schema passed directly as inputSchema)
2. **Transport**: Streamable-HTTP single local server, stateless (sessionIdGenerator undefined), bound to 127.0.0.1, single `/mcp` endpoint, env-var auth (PLANE_API_KEY + PLANE_WORKSPACE_SLUG + optional PLANE_BASE_URL/PORT)
3. **Tool Scope**: exactly ~25 core ticket-workflow tools (users/projects/work items/comments/relations/states/labels/members/cycles/modules) — full catalog in `plans/plane-mcp/00-rfc.md`
4. **Rejected alternatives**: stdio-only transport, full 100+ tool scope (mirroring the official Python server), MCP SDK v1 (`@modelcontextprotocol/sdk`) — rationale in `plans/plane-mcp/00-rfc.md` Alternatives section
5. **Architecture laws**: tools are pure functions `(authContext, args) -> result`; one `PlaneClient` class is the sole Plane API boundary; `list_*` tools return the raw pagination envelope (no auto-paging); 429s surfaced as tool errors, never swallowed; field-name asymmetry (`state`/`state_id`, `assignees`/`assignee_ids`, `target_date`/`due_date`) normalized centrally in `src/plane/normalize.ts`

## Blockers / decisions pending

- None — RFC and full phase plan (00-09) are written. Next action is starting Phase 01 (`plans/plane-mcp/01-scaffold.md`) per `docs/plans/README.md`'s rule: never start a feat without opening its plan.md.
