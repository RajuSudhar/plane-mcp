# 00-baseline.md

## Baseline SHA

- **Full**: `d13168addd6538fee9ba1b84160e41f45d17cab3`
- **Short**: `d13168a`
- **Branch**: `master`
- **Latest commit**: `d13168a auth: keychain-backed setup with multi-instance`

## Plan Tier

`feature` — consumer-facing tool changes (response shaping, list projections, retrieve filters, context docs).

## Working-tree Drift

Modified files:

- `docs/plans/TRACK.md` — tracking document updated with new phases
- `examples/macos-launchd/com.plane-mcp.server.plist` — user's local launchd configuration
- `examples/macos-launchd/plane-mcp-serve.sh` — user's local launchd script
- `plans/plane-mcp/00-rfc.md` — amended RFC with phase resequencing

Untracked files:

- `plans/plane-mcp/17-response-shaping.md` — new feature plan (response shaping)
- `plans/plane-mcp/18-list-projections.md` — new feature plan (list projections)
- `plans/plane-mcp/19-retrieve-shaping.md` — new feature plan (retrieve shaping)
- `plans/plane-mcp/20-context-docs.md` — new feature plan (context docs)

**Tool source files status**: The tool source files this feature will touch — `src/tools/work-items.ts`, `src/tools/modules.ts`, `src/tools/cycles.ts`, `src/plane/client.ts`, `types/client.ts` — are **UNMODIFIED** at the baseline SHA (none appear in `git status --short`).

## Sibling Plans

All phase plans present in `plans/plane-mcp/`:

- `00-rfc.md` — Initial RFC and roadmap
- `01-scaffold.md` — Project setup, TypeScript config, MCP SDK
- `02-tooling.md` — Linting, formatting, type-check
- `03-transport.md` — HTTP transport layer
- `04-plane-client.md` — Plane API client, auth, retry
- `05-tools-foundation.md` — MCP tool registration foundation
- `06-work-items.md` — Work item tools (create, read, update, list)
- `07-collaboration.md` — Comment tools
- `08-workflow.md` — State and label tools
- `09-sprints.md` — Cycle and module tools
- `10-hardening.md` — Error handling, validation
- `11-distribution.md` — README, install docs, examples
- `12-type-aware-lint.md` — Type-aware linting (oxlint + tsgolint)
- `13-test-type-safety.md` — Test type safety (remove casts)
- `14-npm-publish.md` — NPM package publishing
- `15-local-service.md` — Local stdio entry, service scripts
- `16-secure-setup.md` — Keychain-backed init CLI
- `17-response-shaping.md` — Response shaping (new, untracked)
- `18-list-projections.md` — List projections (new, untracked)
- `19-retrieve-shaping.md` — Retrieve shaping (new, untracked)
- `20-context-docs.md` — Context docs (new, untracked)

## Note

Baseline pinned by builder before spec-planner amendment adding the work-item-endpoints correctness phase and resequencing 17–21.
