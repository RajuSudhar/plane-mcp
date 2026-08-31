# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-beta.0] - 2026-08-31

### Added

- Keychain-backed multi-instance auth via `plane-mcp init <name>` command. Securely stores API keys in the OS keychain (macOS `security`, Linux `secret-tool`, Windows file fallback) and prints a ready-to-paste MCP client config with `PLANE_MCP_INSTANCE`/`PLANE_WORKSPACE_SLUG`/`PLANE_BASE_URL` env vars. Multiple named instances per workspace are supported with zero collision.
- stdio transport entry point (`src/stdio.ts`) alongside the existing streamable-HTTP transport. `package.json` `bin` gains `plane-mcp` (stdio, default) and `plane-mcp-http` (HTTP). Enables local single-user install via `bunx plane-mcp` or `bun link`.
- Configurable per-tool output-token limits via a validated `plane-mcp.config.json` file with JSON Schema (`$schema`) support, discovery order (`PLANE_MCP_CONFIG` → `./plane-mcp.config.json` → `~/.config/plane-mcp/config.json`), env overrides (`PLANE_MCP_MAX_OUTPUT_TOKENS`), and strict reject-and-guide enforcement using gpt-tokenizer (o200k_base, ×1.2 multiplier). Responses over the limit are withheld entirely with guidance on how to narrow the request.
- `plane-mcp help` command and `--help`/`-h` flags for CLI usage, config discovery order, and env-var reference.
- `plane-mcp init` now supports `-y`/`--config-path`/`--max-output-tokens` flags and scaffolds a starter `plane-mcp.config.json` (never overwrites).
- `retrieve_work_item_by_identifier` now resolves a bare human identifier like `BZ-5777` in one call, without requiring separate `project_id` or `project_identifier` parameters.
- Type-aware linting via oxlint + oxlint-tsgolint (Go-based, TypeScript 7 compatible). Enforces promise-safety rules: no-floating-promises, no-misused-promises, await-thenable, require-await.
- Structural `PlaneApi` interface for tool layer testability. Eliminates unsafe type casts via typed contracts and constructor-injected fetch mocks.

### Fixed

- Module/cycle membership endpoints now use the correct `/module-issues` and `/cycle-issues` sub-resources with an `{issues: [...]}` body (previously 404).
- `create_work_item_relation` now sends the required `issues` array (previously 400).
- API reference and architecture docs corrected to match actual shipped code.

### Changed

- **BREAKING**: `retrieve_work_item_by_identifier` input changed from three parameters (`project_id`, `project_identifier`, `work_item_identifier`) to a single `identifier` string (e.g., `"BZ-5777"`).

### Known Limitations (Beta)

- Requires Bun >=1.3.14. This is a Bun-native package; bins execute `.ts` files directly. Node-only users would need a separate build (out of scope for this release).
- Endpoints validated against a self-hosted Plane Community instance. Plane Cloud or other deployment variants may differ in endpoint availability or behavior.
- The public Plane REST API on Community does not support server-side filtering by state/priority/assignee/label/module/cycle on `list_work_items`, nor keyword search on Community (Pro-tier/OpenSearch only). These limitations are documented in the tool descriptions.
- Response-shaping/minimal-field projections (planned phases 17-21) are NOT in this release. Tool payloads are still full objects. Mitigate large responses with the configurable per-tool output-token limits (see Added, above).
- Please report issues to https://github.com/RajuSudhar/plane-mcp/issues.

## [0.1.0] - 2026-08-07

Initial release. 31 core ticket-workflow tools (users, projects, work items, comments, relations, states, labels, members, cycles, modules) via stateless streamable-HTTP transport with env-var auth.
