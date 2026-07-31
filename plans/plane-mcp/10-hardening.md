# feat-hardening

Phase: 10 | Status: [ ] planned
Depends on: 09-sprints
Ref: `plans/plane-mcp/00-rfc.md`, all prior phase files

## Goal

Close out the project: author `README.md` and `docs/ARCHITECTURE.md`, do a
final full-repo review pass, and confirm the "zero `.js` emitted, all 25
tools present" invariants hold.

## In scope

- `README.md` — install, env config, connecting an MCP client.
- `docs/ARCHITECTURE.md` — system diagram, layering, request lifecycle.
- Final review pass across `src/`, `types/`, tests.
- Explicit verification that no `.js`/`.d.ts`/`.map` file exists anywhere in
  the repo.
- Explicit verification that all 25 locked tools are registered exactly
  once, with no duplicates and no accidental extras (e.g. a lingering
  `ping`).
- `docs/plans/TRACK.md` — final sweep marking every phase `[x]`.

## Out of scope

- Any new tool, endpoint, or feature. This phase touches documentation and
  verification only — if a gap is found that requires new code, open a
  follow-up phase/RFC rather than scope-creeping this one.
- CHANGELOG, versioning/release automation, npm publish — not requested by
  the RFC; `bin.plane-mcp` exists (Phase 01) but publishing is a distinct
  future decision.

## Design

### `README.md` — required sections

1. **What this is** — one paragraph: MCP server for Plane, ~25 ticket-
   workflow tools, Bun/TypeScript, streamable HTTP.
2. **Install** —
   ```bash
   bun install
   ```
3. **Configure** — required/optional env vars, matching `src/config.ts`
   exactly:

   | Var                    | Required | Default                                    |
   | ---------------------- | -------- | ------------------------------------------ |
   | `PLANE_API_KEY`        | Yes      | —                                          |
   | `PLANE_WORKSPACE_SLUG` | Yes      | —                                          |
   | `PLANE_BASE_URL`       | No       | `https://api.plane.so`                     |
   | `PORT`                 | No       | value from Phase 03's `loadPort()` default |

   Note where to generate `PLANE_API_KEY` (Plane → Profile Settings →
   Personal Access Tokens, or Workspace Settings → Access Tokens for a bot
   token) — cite spec report §4.1 step 1.

4. **Run** —
   ```bash
   bun run start
   # or, for local iteration:
   bun run dev
   ```
5. **Connect an MCP client** — at minimum, an HTTP-transport config snippet
   (adapt the shape from spec report §12's "Claude Desktop — remote PAT" and
   "VS Code" examples, but pointed at this server's local `/mcp` endpoint
   with no OAuth and no `x-api-key`/`x-workspace-slug` headers — auth is
   env-var-only per this server's locked design, not per-request headers).
   Example:
   ```json
   {
     "mcpServers": {
       "plane": {
         "url": "http://127.0.0.1:3000/mcp",
         "type": "http"
       }
     }
   }
   ```
6. **Tool inventory** — the full list of 25 tools, grouped by resource
   (mirror the grouping used across Phases 05-09), each with a one-line
   description.
7. **Development** — `bun run typecheck`, `bun test`, `bun run format`/
   `bun run lint` (Phase 02), and a note on the `noEmit` TypeScript setup
   and why no `dist/` exists.

### `docs/ARCHITECTURE.md` — required sections

1. **System diagram** — reuse/adapt the ASCII diagram from
   `plans/plane-mcp/00-rfc.md`'s Proposed Design section, updated to reflect
   whatever the implementation actually settled on for the
   `createMcpHonoApp` stateless wiring (Phase 03's Open Questions may have
   resolved differently than the RFC's sketch — reconcile here).
2. **Layering** — a table or short section per layer: transport (`src/
index.ts`, `src/server.ts`), config (`src/config.ts`), Plane client
   (`src/plane/`), tools (`src/tools/`), types (`types/`) — one paragraph
   each on responsibility and what it must never do (e.g. "tools never
   construct their own `PlaneClient`", "the client never imports a tool").
3. **Request lifecycle** — numbered walkthrough of one full tool call, e.g.
   `create_work_item`:
   1. MCP client POSTs a `tools/call` JSON-RPC request to `/mcp`.
   2. Hono routes it into a freshly-constructed `McpServer` + transport
      (stateless — no session reuse).
   3. `McpServer` validates `args` against the tool's zod `inputSchema`.
   4. `toolHandler` wrapper logs `tool_execute` start, invokes the pure
      tool function.
   5. Tool function calls `toWorkItemWriteBody` to normalize field names,
      then `PlaneClient.post(...)`.
   6. `PlaneClient` injects `X-API-Key`, sends the request; on 429 it
      backs off and retries up to `MAX_RETRIES` before throwing
      `PlaneRateLimitError`.
   7. On success, the tool returns `{ content, structuredContent }`; on
      error, `toolHandler` maps it to `{ content, isError: true }`.
   8. Response flows back through Hono to the MCP client.
4. **Field-name normalization** — a short explainer + table of the
   `state`/`state_id`, `assignees`/`assignee_ids`,
   `target_date`/`due_date` asymmetry (source: spec report §7.1), and a
   pointer to `src/plane/normalize.ts` as the single place it's handled.
5. **What's explicitly out of scope** — copy the Non-goals list from
   `00-rfc.md` verbatim (or close to it) so a reader of just this one doc
   understands the boundary without needing to find the RFC.

### Final review checklist (this phase's actual verification work)

- [ ] `grep -rl` (or equivalent) across the repo for any `.js`, `.d.ts`,
      `.map` file outside `node_modules` — must return nothing.
- [ ] Cross-check the tool list registered across `src/server.ts` (which by
      now calls all 9 `register*Tools` functions from Phases 05-09) against
      the 25-tool list in `00-rfc.md` — every tool present exactly once, no
      `ping` remnant, no accidental duplicate registration.
- [ ] `bun run typecheck` — zero errors.
- [ ] `bun run format:check` and `bun run lint` — both zero errors (Phase
      02's formatting/lint gate must still hold at the end of the project).
- [ ] `bun test` — all suites green, and spot-check that test count roughly
      matches "every tool has at least a success-path and an error-path
      test" (25 tools x >=2 tests each, plus `PlaneClient`/`normalize`
      tests from Phase 04 — a rough floor, not an exact number to hit).
- [ ] Manually boot the server, run through the spec report §10 example
      workflows end-to-end against a real (or sandboxed) Plane workspace at
      least once each: - Look up by human-readable ID - Create a triaged bug - Move a work item to Done + comment - Sprint planning (create cycle, list cycles) - Cross-project search (adapted to this server's project-scoped
      `list_work_items` — confirm the workflow still holds with the
      narrower scope) - Add to a module

## Tasks

- [ ] Write `README.md` per Design
- [ ] Write `docs/ARCHITECTURE.md` per Design
- [ ] Run the Final review checklist above, fix anything it surfaces
- [ ] Update `docs/plans/TRACK.md`: replace all phase rows with `[x]`, add
      a "Done" entry noting the full ~25-tool server is complete
- [ ] Update `CLAUDE.md`'s "Routing" table rows currently marked `TBD` to
      point at the real files (`plans/plane-mcp/0X-*.md`,
      `docs/ARCHITECTURE.md`) now that they exist

## Definition of done

- [ ] `README.md` covers install, env config, run, client connection, full
      tool inventory, dev commands
- [ ] `docs/ARCHITECTURE.md` covers system diagram, layering, request
      lifecycle, field normalization, explicit non-goals
- [ ] Zero `.js`/`.d.ts`/`.map` files anywhere outside `node_modules`
- [ ] All 25 tools confirmed present, none missing, none duplicated
- [ ] `bun run typecheck`, `bun run format:check`, `bun run lint`, and
      `bun test` all green
- [ ] `docs/plans/TRACK.md` fully updated, no `TBD` placeholders remain
- [ ] `CLAUDE.md` routing table updated to remove stale `TBD` entries

## Open questions

- None expected at this stage — this phase is a closing/verification pass
  over decisions already locked in Phases 00-09. If the final review
  surfaces a genuine gap (e.g. a tool whose behavior doesn't match its
  phase file), fix the code/tests to match the phase file, or — if the
  phase file itself was wrong — correct that phase file and note the
  discrepancy in `docs/plans/TRACK.md`'s decisions log rather than silently
  diverging.
