# TRACK — Plane MCP

Last updated: 2026-08-06

## Status legend

[x] done [~] wip [ ] todo [!] blocked

## Phases

Plan docs: `plans/plane-mcp/00-rfc.md` (RFC) through `plans/plane-mcp/12-type-aware-lint.md`.

### Phase 00 — RFC

[x] `plans/plane-mcp/00-rfc.md` — problem, goals/non-goals, architecture, alternatives rejected (stdio-only, full 100+ tool scope, MCP SDK v1), risks, phase sketch

### Phase 01 — Scaffold

[x] `plans/plane-mcp/01-scaffold.md` — package.json, tsconfig, bunfig.toml, pinned deps, CI, src/index.ts stub, types/ dir, src/logger.ts

### Phase 02 — Tooling

[x] `plans/plane-mcp/02-tooling.md` — Prettier as the single formatter for `.ts`/`.json`/`.md` (with per-language overrides), oxlint linter for `.ts` correctness (`.oxlintrc.json` enforcing type-over-interface, no-any, type-imports), committed `.githooks/pre-commit` wired via `core.hooksPath`, CI gating (`format:check` + `lint`), one-time full-repo baseline reformat

### Phase 03 — Transport

[x] `plans/plane-mcp/03-transport.md` — stateless streamable-HTTP server on /mcp, health endpoint, AuthContext loader, McpServer factory, temporary ping tool

### Phase 04 — Plane Client

[x] `plans/plane-mcp/04-plane-client.md` — PlaneClient class, pagination passthrough, 429 handling, typed errors, field-normalization helpers

### Phase 05 — Tools Foundation

[x] `plans/plane-mcp/05-tools-foundation.md` — tool-registration pattern, zod v4 schemas, first vertical slice (get_me, list_projects, retrieve_project)

### Phase 06 — Work Items

[x] `plans/plane-mcp/06-work-items.md` — list/retrieve/retrieve_by_identifier/create/update/delete/search work items, field normalization

### Phase 07 — Collaboration

[x] `plans/plane-mcp/07-collaboration.md` — comments CRUD, relations CRUD (relation_type enum)

### Phase 08 — Workflow

[x] `plans/plane-mcp/08-workflow.md` — states, labels, project/workspace members

### Phase 09 — Sprints

[x] `plans/plane-mcp/09-sprints.md` — cycles + modules, work-item join/unjoin tools

### Phase 10 — Hardening

[x] `plans/plane-mcp/10-hardening.md` — README.md, docs/ARCHITECTURE.md, final review, zero-.js verification, full tool inventory check

### Phase 11 — Distribution

[x] `plans/plane-mcp/11-distribution.md` — `src/stdio.ts` stdio transport entry point (reuses `createServer`/`loadAuthContext`), `package.json` `bin` gains `plane-mcp` (stdio, default) + `plane-mcp-http` (HTTP), `bun link` local-install flow, README "Install as a local MCP (stdio)" section, stdio smoke test (in-process preferred), RFC amended (stdio Non-goal superseded for the local-install case; HTTP unchanged)

### Phase 12 — Type-Aware Linting

[x] `plans/plane-mcp/12-type-aware-lint.md` — reclaim the type-aware linting capability compromised in Phase 05 when typescript-eslint had no TypeScript 7 support: bump `oxlint` to `1.77.0`, add `oxlint-tsgolint@7.0.2001` (exact-pinned), enable `.oxlintrc.json`'s root `options.typeAware`, add `typescript/no-floating-promises` + `typescript/no-misused-promises` + `typescript/await-thenable` + `typescript/require-await` (kept unscoped; zero findings in codebase), fix all genuine findings (2 false-positive await-thenable in test mocks, inline-disabled with justification), no CI workflow change needed

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
- Full phase plan authored: `plans/plane-mcp/01-scaffold.md` through `plans/plane-mcp/10-hardening.md` (11 files: RFC + 10 phases)
- Phase 01 (scaffold) implemented and committed
- Tooling phase inserted as the new Phase 02 (formatting/linting baseline via Prettier + oxlint); every downstream phase (former 02-09) renumbered to 03-10; all internal cross-references and `Depends on:` chains updated to match
- All 10 phases (00-10) completed, all 31 tools shipped across 10 resource domains (users, projects, work items, comments, relations, states, labels, members, cycles, modules)
- Phase 11 (distribution) implemented and committed: `plans/plane-mcp/11-distribution.md` authored and completed; `src/stdio.ts` stdio transport entry point added, `package.json` `bin` gains `plane-mcp` (stdio, default) + `plane-mcp-http` (HTTP), README "Install as a local MCP (stdio)" section added, `plans/plane-mcp/00-rfc.md` amended (Non-goals + Alternatives) to record stdio addition post-hardening for local single-user install
- Phase 12 (type-aware linting) implemented and committed: `oxlint` bumped 1.76.0 → 1.77.0, `oxlint-tsgolint@7.0.2001` added (prebuilt Go binary via optional platform deps), `.oxlintrc.json` gains root `options.typeAware: true`, type-aware rules (`no-floating-promises`, `no-misused-promises`, `await-thenable`, `require-await`) added, 2 false-positive test-mock findings fixed with justified inline disables, zero `src/` findings, all tests pass, CLAUDE.md + README.md updated to reflect type-aware linting, zero CI workflow changes needed

## Decisions / deviations

1. **SDK + Validation**: MCP SDK v2 (`@modelcontextprotocol/server`, 2.0.0 exact) + `@modelcontextprotocol/hono` for transport, Zod v4 for runtime validation (schema passed directly as inputSchema)
2. **Transport**: Streamable-HTTP single local server, stateless (sessionIdGenerator undefined), bound to 127.0.0.1, single `/mcp` endpoint, env-var auth (PLANE_API_KEY + PLANE_WORKSPACE_SLUG + optional PLANE_BASE_URL/PORT)
3. **Tool Scope**: exactly 31 core ticket-workflow tools (users/projects/work items/comments/relations/states/labels/members/cycles/modules) — full catalog in `plans/plane-mcp/00-rfc.md`
4. **Rejected alternatives**: stdio-only transport, full 100+ tool scope (mirroring the official Python server), MCP SDK v1 (`@modelcontextprotocol/sdk`) — rationale in `plans/plane-mcp/00-rfc.md` Alternatives section
5. **Architecture laws**: tools are pure functions `(authContext, args) -> result`; one `PlaneClient` class is the sole Plane API boundary; `list_*` tools return the raw pagination envelope (no auto-paging); 429s surfaced as tool errors, never swallowed; field-name asymmetry (`state`/`state_id`, `assignees`/`assignee_ids`, `target_date`/`due_date`) normalized centrally in `src/plane/normalize.ts`
6. **Tooling stack (Phase 02)**: Prettier is the single formatter for every file type (`.ts`, `.json`, `.md`) with per-language overrides — no Biome. oxlint (`.oxlintrc.json`) owns `.ts` correctness/linting, enforcing the three hard-rule mappings: `typescript/consistent-type-definitions` (type-over-interface), `typescript/no-explicit-any`, `typescript/consistent-type-imports`. typescript-eslint was rejected because it lacks TypeScript 7 support; oxlint is a Rust-based linter with zero TypeScript compiler coupling, so the TS7 pin cannot break it. A committed, zero-dependency `.githooks/pre-commit` script (wired via `git config core.hooksPath .githooks`) runs Prettier then oxlint before every commit; `--no-verify` is never used. Phase 02 runs immediately after scaffold, before any feature code, so the one-time full-repo baseline reformat never collides with a later feature commit.
7. **stdio transport added (Phase 11, post-hardening)**: `plans/plane-mcp/00-rfc.md`'s Non-goals originally listed "stdio transport. HTTP-only." This is amended, not reversed: stdio is added as a second, additive transport (`src/stdio.ts`, reusing `createServer()`/`loadAuthContext()` unmodified) for local single-user install via `bun link` and command-launched MCP client configs (`mcpServers.<name>.command`). HTTP (`src/index.ts`) remains the transport for the "one server, multiple clients" shape the RFC locked in and is unchanged by this phase. `package.json` `bin.plane-mcp` now points at the stdio entry (the default local-MCP command); a new `bin["plane-mcp-http"]` covers the HTTP entry explicitly. `private: true` unchanged — no npm publish; `bun link` needs no registry. Full rationale: `plans/plane-mcp/00-rfc.md` Non-goals + Alternatives amendments; full spec: `plans/plane-mcp/11-distribution.md`.
8. **Type-aware linting reclaimed (Phase 12)**: Phase 02 adopted oxlint over the ESLint/`typescript-eslint` stack because `typescript-eslint` has no TypeScript 7 support path, and explicitly recorded type-aware linting as an unavailable capability at that time (oxlint was, at the time, purely syntactic). `typescript-eslint` still has no TS7 support as of this phase (peer range `>=4.8.4 <6.1.0`, latest published `8.66.0`; upstream tracking issue #12518 closed "not planned," pending an unshipped TS7.1 stable compiler API) — so ESLint remains off the table. However, oxlint shipped stable type-aware linting via `tsgolint` on 2026-07-22 — a Go-based rule engine with its own embedded TS7-compatible compiler, independent of the `typescript` npm package/`tsc`, so it is unaffected by the incompatibility blocking `typescript-eslint`. Phase 12 turns this on: `oxlint` bumped to `1.77.0`, new exact-pinned devDep `oxlint-tsgolint@7.0.2001` (prebuilt Go binary via npm `optionalDependencies`, no Go toolchain needed), `.oxlintrc.json` gains root `options.typeAware: true` plus `typescript/no-floating-promises`, `typescript/no-misused-promises`, `typescript/await-thenable` (and `typescript/require-await` per a recorded per-implementation decision) as `"error"`. Config format stays `.oxlintrc.json` (JSON) — `oxlint.config.ts` was rejected because it requires a Node v22.18+/v24+ runtime, which does not work under Bun. No CI workflow change: the existing frozen `bun install` step already resolves `oxlint-tsgolint`'s platform optional dependency once `bun.lock` is regenerated and committed. This reverses the Phase 02/05-era compromise, not the RFC's linter choice — oxlint remains the linter; only its configuration gained a capability. Full spec: `plans/plane-mcp/12-type-aware-lint.md`.

## Blockers / decisions pending

- Open (deferred, not blocking): whether `package.json`'s `private: true` is ever flipped for a future real `bunx`-without-`bun-link` npm publish. Not decided; tracked in Phase 11's Open questions.
