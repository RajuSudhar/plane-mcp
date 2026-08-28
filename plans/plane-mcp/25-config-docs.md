# feat-config-docs

Phase: 25 | Status: [ ] todo
Depends on: 22-server-config, 23-token-enforcement, 24-cli-config-help
Ref: `README.md`, `docs/SECURITY.md`, `CLAUDE.md`, `.env.example`,
`plans/plane-mcp/22-server-config.md` through `24-cli-config-help.md`

## Goal

Make the config-file model, token-limit enforcement, and new CLI surface
(`-y`, `help`) discoverable in every doc a human reader already consults —
`README.md`, `CLAUDE.md`'s routing table, `.env.example` — with no further
code changes. `docs/SECURITY.md`'s dependency entry for `gpt-tokenizer` was
already recorded in Phase 23 (where the dependency was added); this phase
does not duplicate it.

## In scope

- `README.md`:
  - New "Configure per-tool output-token limits" section: what the config
    file is, the discovery order, a minimal example, the `$schema` field,
    and the reject-and-guide behavior (a breach returns an error with
    narrowing suggestions, never a truncated payload).
  - `plane-mcp init` section (Step 1) gains a sentence noting it now also
    scaffolds this config file and prints `PLANE_MCP_CONFIG`, plus the
    `-y` flag in the options list.
  - New row in the existing env-var table (`PLANE_MCP_CONFIG`,
    `PLANE_MCP_MAX_OUTPUT_TOKENS`).
  - New "Commands" table row: `plane-mcp help`.
- `.env.example` — new commented block for `PLANE_MCP_CONFIG` and
  `PLANE_MCP_MAX_OUTPUT_TOKENS`, both left blank/commented (optional,
  matching the file's existing style for optional vars like `PLANE_BASE_URL`/`PORT`).
- `CLAUDE.md` routing table — two new rows: config-file loading/schema/
  discovery → `plans/plane-mcp/22-server-config.md`; token-limit
  enforcement/`gpt-tokenizer` → `plans/plane-mcp/23-token-enforcement.md`.
  Also a routing row for the `help` subcommand →
  `plans/plane-mcp/24-cli-config-help.md`.
- `plane-mcp.config.json` example file (new, repo root, **not** loaded by
  discovery unless a user runs the server from the repo root with no other
  config present — documented as illustrative) demonstrating `$schema`,
  `defaults`, and one `tools` override.

## Out of scope

- Any further code change — this phase touches only markdown, the
  `.env.example` template, `CLAUDE.md`, and one illustrative JSON example
  file (not consumed by any test or code path).
- `docs/SECURITY.md` — already updated in Phase 23 at the point the
  dependency was added; not re-touched here.
- `docs/ARCHITECTURE.md` — out of scope; this feature does not change the
  transport/client/tool-registry layering that document describes, only
  adds a config-loading step alongside the existing `AuthContext` loading
  step already documented there implicitly via `src/config.ts`.

## Design

### `README.md` — new section (placed after "Configure via environment

variables (advanced)", before "Tool Inventory")

````markdown
## Configure per-tool output-token limits

By default, every tool's response is capped at 25,000 estimated tokens. A
response over the limit is never truncated — it is withheld entirely, and
the tool returns an error explaining how to narrow the request (e.g. via
`fields`, `per_page`, or `module_id`/`cycle_id` filtering).

This limit is controlled by an optional JSON config file, resolved in this
order:

1. `PLANE_MCP_CONFIG` env var (must be an absolute path to the file)
2. `./plane-mcp.config.json` (current working directory)
3. `~/.config/plane-mcp/config.json` (honors `XDG_CONFIG_HOME` /
   `PLANE_MCP_CONFIG_DIR`, same directory `plane-mcp init` uses for
   credentials)
4. None found — built-in default (25,000 tokens per tool), zero config
   required

Example `plane-mcp.config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/RajuSudhar/plane-mcp/master/plane-mcp.config.schema.json",
  "defaults": {
    "maxOutputTokens": 25000
  },
  "tools": {
    "list_work_items": {
      "maxOutputTokens": 10000
    }
  }
}
```
````

The `$schema` field enables editor validation/autocomplete and is ignored
at runtime. Unknown or misspelled keys anywhere in the file are rejected
at startup with a precise error, rather than silently ignored.

`PLANE_MCP_MAX_OUTPUT_TOKENS` (an integer) overrides `defaults.maxOutputTokens`
for a quick one-off change without editing the file — useful for CI or a
single scripted run.

`plane-mcp init` scaffolds a starter config file for you (see Setup,
above) and records its location as `PLANE_MCP_CONFIG` in the printed MCP
client config.

````

### `README.md` — Setup section edit

Under "The command will:", add a 4th numbered item:

```markdown
4. Scaffold a starter `plane-mcp.config.json` (unless one already exists
   at the target path) and add `PLANE_MCP_CONFIG` to the printed config.
````

And in the flags list, add:

```markdown
- `-y` (optional): Skip the config-scaffold confirmation prompt and use
  defaults (`~/.config/plane-mcp/config.json`, 25,000 tokens/tool).
```

### `README.md` — env-var table addition

Append two rows to the existing table under "Configure via environment
variables (advanced)":

```markdown
| `PLANE_MCP_CONFIG` | No | (discovery order, see above) | Absolute path to a behavior config file |
| `PLANE_MCP_MAX_OUTPUT_TOKENS` | No | `25000` | Overrides the default per-tool output-token limit |
```

### `README.md` — Commands table addition

```markdown
| `plane-mcp help` | Print CLI usage, config discovery order, and env-var reference |
```

### `.env.example` addition

```dotenv
# Optional: absolute path to a behavior config file (per-tool output-token
# limits). See README.md "Configure per-tool output-token limits" for the
# full discovery order and config shape. Unset by default — zero config
# required.
# PLANE_MCP_CONFIG=

# Optional: override the default per-tool output-token limit (default: 25000)
# PLANE_MCP_MAX_OUTPUT_TOKENS=25000
```

### `CLAUDE.md` routing table additions

```markdown
| Config file, discovery order, schema | `plans/plane-mcp/22-server-config.md` |
| Token limits, reject-and-guide, gpt-tokenizer | `plans/plane-mcp/23-token-enforcement.md` |
| CLI `-y`/scaffold/`help` subcommand | `plans/plane-mcp/24-cli-config-help.md` |
```

### `plane-mcp.config.json` (repo-root example)

```json
{
  "$schema": "./plane-mcp.config.schema.json",
  "defaults": {
    "maxOutputTokens": 25000
  },
  "tools": {
    "list_work_items": {
      "maxOutputTokens": 10000
    },
    "search_work_items": {
      "maxOutputTokens": 10000
    }
  }
}
```

Placed at the repo root purely as a readable, copy-pasteable example next
to the generated `plane-mcp.config.schema.json` (Phase 22) — its
`$schema` uses the relative path since, unlike the `plane-mcp init`
scaffold (Phase 24, which uses the GitHub raw URL because it is written
outside the repo), this file is colocated with the schema it references.
Running `plane-mcp`/`bun run dev` from the repo root **will** pick this
file up via discovery order step 2 (`./plane-mcp.config.json`) — this is
called out explicitly in the file's own top-level comment equivalent
(JSON has no comments; the README section above states it) so a
contributor is not surprised by a 10,000-token cap on `list_work_items`
while developing locally.

## Tasks

- [ ] Add the "Configure per-tool output-token limits" section to
      `README.md`
- [ ] Edit the `plane-mcp init` Setup section (numbered step + `-y` flag)
- [ ] Add the two env-var table rows
- [ ] Add the `plane-mcp help` Commands table row
- [ ] Add the `.env.example` block
- [ ] Add the three `CLAUDE.md` routing rows
- [ ] Create the repo-root `plane-mcp.config.json` example
- [ ] Run `bun run format:check` — passes (markdown + JSON formatting)
- [ ] Run `bun test` — all green (no test asserts on `README.md`/
      `CLAUDE.md` content; the repo-root `plane-mcp.config.json` is
      exercised indirectly by `src/config.test.ts`'s cwd-discovery case
      only if that test's working directory is the repo root — confirm
      no existing test accidentally picks it up and gets a different
      `maxOutputTokens` than it expects; if so, that test must inject an
      explicit `PLANE_MCP_CONFIG`/mocked `fileExists` rather than relying
      on cwd discovery)
- [ ] Run `bun run typecheck` — passes

## Definition of done

- [ ] A first-time reader of `README.md` can find the config file's
      discovery order, shape, and default limit without opening a phase
      doc
- [ ] `CLAUDE.md` routes all three new concerns (config file, token
      limits, CLI help) to their owning phase doc
- [ ] `.env.example` documents both new optional env vars
- [ ] No test in the suite is broken by the new repo-root
      `plane-mcp.config.json` example file being picked up by cwd
      discovery
- [ ] `docs/plans/TRACK.md` updated: Phase 25 row `[~]` at start, `[x]` at
      completion; feature marked complete in the Decisions/deviations log
      (one consolidated entry summarizing Phases 22-25)

## Open questions

- None.
