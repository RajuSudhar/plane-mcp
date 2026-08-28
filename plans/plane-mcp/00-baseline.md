# 00-baseline.md

## Baseline SHA

- **Full**: `d4eaff2e9879122a57967965696d466dff79a67a`
- **Short**: `d4eaff2`
- **Branch**: `master`
- **Latest commit**: `d4eaff2 tools: resolve work items by human identifier`

## Plan Tier

`feature` — upcoming configurable-token-limit / server-config phases.

## Working-tree Drift

Working tree is clean at HEAD (d4eaff2) apart from this baseline file edit.

**Config-feature relevant files** — the following files are **UNMODIFIED** at HEAD (confirmed via `git status --short`):

- `src/config.ts`
- `types/config.ts`
- `src/server.ts`
- `src/tools/register.ts`
- `src/stdio.ts`
- `src/index.ts`
- `src/init.ts`
- `package.json`
- `docs/SECURITY.md`
- `src/logger.ts`

These are the surfaces the upcoming configurable-token-limit feature will touch.

## Sibling Plans

All phase plans present in `plans/plane-mcp/`:

- `00-baseline.md` — This baseline (tracking current HEAD)
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
- `17-response-shaping.md` — Response shaping
- `18-work-item-endpoints.md` — Work item endpoints correctness
- `19-list-projections.md` — List projections
- `20-retrieve-shaping.md` — Retrieve shaping
- `21-context-docs.md` — Context docs

**No MOVED stub files present** — all phase plans are canonical documents.

## Note

Baseline refreshed by builder before spec-planner adds the configurable output-token-limit / server-config phases (22+). New dep planned: gpt-tokenizer@4.0.0 (pure-JS, MIT), pending docs/SECURITY.md check.
