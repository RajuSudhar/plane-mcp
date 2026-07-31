# feat-tooling

Phase: 02 | Status: [x] done
Depends on: 01-scaffold
Ref: `plans/plane-mcp/00-rfc.md`, `docs/CODING-STANDARDS.md`, `CLAUDE.md`

## Goal

Establish the formatting/linting baseline — Prettier as the single formatter
for every file type (`.ts`, `.json`, `.md`), oxlint for `.ts` correctness, a
zero-dependency committed pre-commit hook, and CI gating — then reformat the
entire existing tree against it in this same commit, so no future feature
phase ever produces a retroactive "format the whole repo" commit that
pollutes git history.

**Locked decisions (do not re-litigate — see orchestrator's resolved
decisions)**:

- **Prettier is the single formatter for all file types.** No Biome. One
  formatter config (with per-language `overrides`) covers `.ts`, `.json`,
  and `.md` alike.
- **oxlint owns `.ts` correctness only**, via `.oxlintrc.json`. oxlint is a
  self-contained Rust binary with zero TypeScript-compiler coupling — it
  parses TypeScript syntactically, it does not invoke `tsc` or load any
  `typescript` package APIs, so the repo's TypeScript 7 pin has no effect on
  it. oxlint does not lint `.json` or `.md`.
- **Pre-commit hook** is a committed, zero-dependency shell script at
  `.githooks/pre-commit`, wired via `git config core.hooksPath .githooks`.
  It runs Prettier across the whole repo, then oxlint, before every commit.
  `--no-verify` is never used anywhere in this repo (hard rule).

## In scope

- Exact-pinned devDeps: `prettier` and `oxlint` (added via
  `bun add --exact --dev`, versions resolved at implementation time — see
  Open questions). Phase 02 adds exactly these two tools total — no ESLint
  stack, no `jiti`.
- `.prettierrc` (or `prettier.config.ts`) — base formatting options matching
  `docs/CODING-STANDARDS.md`'s Formatting Standards, plus an `overrides`
  block giving correct per-language settings for `*.md` and `*.json`.
- `.prettierignore` — `node_modules`, `bun.lock`.
- `.oxlintrc.json` — the three hard-rule enforcements below, scoped to `.ts`
  by oxlint's own default file targeting.
- `package.json` scripts: `format`, `format:check`, `lint`, `lint:fix`,
  `check` — resolving the `TBD` script names in `CLAUDE.md`.
- `.githooks/pre-commit` — committed shell script, zero dependencies, wired
  via `git config core.hooksPath .githooks`.
- `.github/workflows/ci.yml` — add `format:check` and `lint` steps alongside
  the existing `typecheck`/`test` steps from Phase 01.
- One-time baseline reformat of the entire existing tree (`.ts`, `.json`,
  `.md` including `docs/` and `plans/`) committed as part of this phase.
- `CLAUDE.md` — resolve the `format`/`lint` script-name `TBD` markers in the
  Commands section to the real script names defined here.

## Out of scope

- Any HTTP server, transport, or MCP registration (Phase 03).
- `PlaneClient` or any Plane API call (Phase 04).
- Any tool implementation (Phases 05-09).
- Writing new tests — the only requirement is that the existing Phase 01
  test command (`bun test`) keeps exiting 0 after formatting/lint changes.
- Type-aware linting (rules that require a full type-check pass against the
  TypeScript compiler). oxlint does not do type-aware linting at all — it is
  a purely syntactic Rust-based linter. The three hard-rule enforcements in
  this phase (`typescript/consistent-type-definitions`,
  `typescript/no-explicit-any`, `typescript/consistent-type-imports`) are all
  syntactic checks and require no compiler integration. Type-aware linting
  (via a separate tool, if ever needed) is a future phase's decision.

## Design

### `package.json` devDependencies (additive to Phase 01's block)

```json
{
  "devDependencies": {
    "@types/bun": "1.3.14",
    "typescript": "7.0.2",
    "prettier": "<RESOLVE_EXACT_AT_IMPLEMENTATION>",
    "oxlint": "<RESOLVE_EXACT_AT_IMPLEMENTATION>"
  }
}
```

**IMPORTANT**: every `<RESOLVE_EXACT_AT_IMPLEMENTATION>` placeholder is not a
version to type literally. Run `bun add --exact --dev prettier oxlint`, let
Bun resolve the actual latest stable versions (per `bunfig.toml`'s
`[install] exact = true`, Bun writes them in without a range), then copy
whatever exact versions land in `package.json` into this file's Design
section before marking this phase done — per `docs/CODING-STANDARDS.md` §
Dependency Management, verify every package against the compromised-package
list before adding.

**Design note — why oxlint replaced the ESLint/typescript-eslint stack**:
this repo pins `typescript@7.0.2` (Phase 01). `typescript-eslint` has no
supported TypeScript 7 release path — the upstream tracking issue for TS7
support was closed as "not planned," blocked on the TS7.1 stable compiler
API, which is still months out at the time of this decision. That leaves
`typescript-eslint` permanently unable to parse this repo's TypeScript
version, which is a hard blocker, not a cosmetic peer-range warning to wait
out. oxlint was adopted instead: it is a single self-contained Rust binary
that parses TypeScript syntax directly, with zero dependency on the
`typescript` package or the `tsc` compiler APIs — TS7 (or any future
TypeScript version) cannot break it the way it broke `typescript-eslint`,
because oxlint never calls into the TypeScript compiler at all. A
Biome-based linter was the considered fallback if oxlint had not covered
the three hard-rule lint checks this repo requires; it wasn't needed since
oxlint covers all three natively.

### `.prettierrc`

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "singleQuote": true,
  "semi": true,
  "trailingComma": "es5",
  "overrides": [
    {
      "files": "*.md",
      "options": {
        "printWidth": 120,
        "proseWrap": "preserve"
      }
    },
    {
      "files": "*.json",
      "options": {
        "printWidth": 80,
        "tabWidth": 2
      }
    }
  ]
}
```

**Base options map 1:1 to `docs/CODING-STANDARDS.md` § Formatting
Standards**: 100-character line length, 2-space indentation, single quotes,
semicolons required, ES5-style trailing commas — these apply to `.ts` (the
only surface those base options were written for).

**`*.md` override**: `printWidth: 120` matches `docs/CODING-STANDARDS.md` §
Markdown Documentation ("120-character line length" under markdownlint
rules) — deliberately wider than the `.ts` base width, since Markdown prose
and code have different documented limits. `proseWrap: "preserve"` avoids
Prettier reflowing prose paragraphs that were manually wrapped for
readability in existing docs (`docs/`, `plans/`).

**`*.json` override**: `printWidth: 80` — JSON files in this repo
(`package.json`, `tsconfig.json`, `.prettierrc` itself) are naturally
shallow/flat and read better at a narrower width than `.ts` code; `tabWidth`
restated explicitly (same value as base) so the override block is
self-contained and doesn't rely on a reader cross-referencing the base
options to know JSON's indent width. `trailingComma` is deliberately not
overridden for JSON — Prettier's JSON printer does not emit trailing commas
regardless of the `trailingComma` setting (standard JSON has no trailing
commas), so restating it would be a no-op; omitted to avoid implying a
setting that does nothing.

**Note**: `bunfig.toml` is TOML, a format Prettier has no built-in parser
for — it is neither matched by an `overrides` entry here nor an ignore
entry; Prettier's CLI skips files it has no parser for when given a
directory glob, so no explicit exclusion is needed.

### `.prettierignore`

```text
node_modules
bun.lock
```

Belt-and-suspenders backstop matching `docs/CODING-STANDARDS.md`'s
dependency-lockfile handling — `bun.lock` is a generated, machine-written
file and must never be reformatted (Prettier reformatting it could produce
a diff that looks like a lockfile change but isn't one Bun actually wrote).

### `.oxlintrc.json`

```json
{
  "rules": {
    "typescript/consistent-type-definitions": ["error", "type"],
    "typescript/no-explicit-any": "error",
    "typescript/consistent-type-imports": "error"
  }
}
```

**Rule-by-rule mapping to the project's hard rules**
(`docs/CODING-STANDARDS.md` / `CLAUDE.md`):

| oxlint rule                                                 | Hard rule enforced                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `typescript/consistent-type-definitions: ["error", "type"]` | "`type` only, never `interface`"                                                          |
| `typescript/no-explicit-any: "error"`                       | "No `any`"                                                                                |
| `typescript/consistent-type-imports: "error"`               | Type-only imports (matches the Import Organization convention: "Type imports (separate)") |

These three rules are the entire enforcement surface this phase requires:
type-over-interface, no `any`, and type-only imports. No other rule
categories (style, formatting, import-order, etc.) are enabled — oxlint owns
correctness only, Prettier owns formatting, and there is no overlap between
the two to disable or coordinate. Unlike the previous ESLint stack, there is
no `eslint-config-prettier`-equivalent step needed here: oxlint ships no
formatting rules in the first place, so there is nothing for it to fight
Prettier over.

**Scope**: oxlint lints `.ts` files only. Markdown remains exclusively
Prettier-formatted (`*.md` is not a lint target — oxlint has no Markdown
rule set, and none is configured here). JSON is likewise formatting-only via
Prettier, never linted.

**Note on `interface` exceptions**: `consistent-type-definitions` set to
`"type"` will flag any `interface` declaration, including the two narrow
exceptions `docs/CODING-STANDARDS.md` allows (class-extends,
declaration-merging). If a future phase hits one of those two legitimate
cases, use a scoped oxlint disable comment for that line with a one-line
reason, rather than loosening the rule globally.

### `package.json` scripts (resolves `CLAUDE.md`'s `TBD` names)

```json
{
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "start": "bun run src/index.ts",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "check": "bun run format:check && bun run lint",
    "prepare": "git config core.hooksPath .githooks"
  }
}
```

**Exact command strings — do not paraphrase at implementation time**:

- `format` — `prettier --write .` mutates every file type Prettier
  recognizes (`.ts`, `.json`, `.md`, and anything else Prettier ships a
  parser for) in place across the whole repo. There is no separate
  Markdown-only invocation — one formatter, one command, covering every
  file type via `.prettierrc`'s `overrides`, not via separate CLI calls.
- `format:check` — `prettier --check .` is the non-mutating equivalent:
  exits non-zero if any file would be reformatted, writes nothing.
- `lint` — `oxlint` reports lint errors per `.oxlintrc.json` (scoped to
  `.ts` by oxlint's own defaults), exits non-zero on any, mutates nothing.
- `lint:fix` — `oxlint --fix` applies oxlint's safe auto-fixes.
- `check` — the combined gate for this phase's scope: formatting must be
  clean AND linting must pass. `typecheck`/`test` remain separate existing
  scripts (Phase 01) and are not folded into `check` — CI (below) runs all
  four as discrete steps so a failure is attributable to the right command.
- `prepare` — Bun runs `prepare` after `bun install` (npm-compatible
  lifecycle script support), so cloning the repo and running `bun install`
  automatically wires `core.hooksPath` without a manual step. The manual
  one-time command is still documented below for anyone who skips
  `bun install`, or whose Bun version does not run `prepare` automatically —
  do not rely on `prepare` alone as the only place this is documented.

### `.githooks/pre-commit`

```sh
#!/bin/sh
set -e

echo "[pre-commit] Formatting (prettier)..."
bun run format

echo "[pre-commit] Re-staging any files the formatter touched..."
git add -u

echo "[pre-commit] Linting (oxlint)..."
bun run lint

echo "[pre-commit] OK"
```

**CRITICAL**: `set -e` means any non-zero exit (from `bun run format`, `git
add -u`, or `bun run lint`) aborts the script immediately, which — because
this is invoked by git as the `pre-commit` hook — aborts the commit. `bun
run lint` failing (lint errors present) is therefore a hard commit block,
matching this phase's Definition of Done. `git add -u` re-stages any file
the formatter modified so the commit actually contains formatted content
rather than silently committing pre-format versions while leaving the
working tree diverged from the index. **NEVER** add `--no-verify` anywhere
in this repo (hard rule, `CLAUDE.md`) — if a commit needs to bypass this
hook for a legitimate reason, that is a discussion to have explicitly, not a
flag to reach for.

The file must be committed with the executable bit set
(`chmod +x .githooks/pre-commit`) — a non-executable hook is silently
skipped by git, which would defeat this phase's entire purpose. It is a
plain POSIX `/bin/sh` script with zero dependencies beyond `git`, `bun`, and
whatever `bun run format`/`bun run lint` themselves need — no extra shell
tooling (e.g. `jq`, `yq`) is introduced.

### Wiring `core.hooksPath` (one-time, per clone)

Documented one-time command (also auto-run via the `prepare` script above):

```bash
git config core.hooksPath .githooks
```

This is a local, per-clone git config value (not committed inside `.git/`
itself) — every fresh clone needs either `bun install` to run `prepare`, or
this command run manually once, before the hook takes effect on that clone.

### `.github/workflows/ci.yml` (updated — adds two steps after Phase 01's)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.14'
      - run: bun install --frozen-lockfile
      - run: bun run format:check
      - run: bun run lint
      - run: bun run typecheck
      - run: bun test
```

**IMPORTANT**: `format:check` and `lint` run before `typecheck`/`test` so a
formatting or lint failure is reported first and fails fast, before paying
for a full type-check + test run. This ordering is a deliberate choice for
this phase, not incidental — keep it if a later phase edits this workflow
file again. `bun run lint` now invokes oxlint, but the step name and
position in the workflow are unchanged.

### Baseline reformat (explicit task, not a side effect)

This phase's implementation runs `bun run format` **once**, across the
entire existing tree — every `.ts` file in `src/` and `types/`, every
`.json` file (`package.json`, `tsconfig.json`; `bunfig.toml` is TOML and
untouched by Prettier), and every `.md` file including everything under
`docs/` and `plans/` — and commits the result as part of this phase's
change set.

**IMPORTANT**: reformatting already-committed files (Phase 00's RFC and
plan docs, Phase 01's scaffold source) in this same commit is intentional
and expected, not a mistake to avoid. The entire point of running this
phase immediately after scaffold is that the baseline reformat happens
exactly once, here, before any feature code exists — so no later phase ever
needs its own "reformat the world" commit mixed in with feature changes.
This also applies to the plan documents themselves (`plans/plane-mcp/*.md`)
— running Prettier over them is expected and should only ever change
whitespace/wrapping, never their content or meaning.

## Tasks

- [ ] `bun add --exact --dev prettier oxlint`; verify each package against
      the compromised-package list; record the resolved exact versions in
      this file's Design section
- [ ] Confirm `bun run lint` (oxlint) runs to completion against the TS7
      sources with no config-loading error and no compiler-coupling issue
- [ ] Write `.prettierrc` per Design
- [ ] Write `.prettierignore` per Design
- [ ] Write `.oxlintrc.json` per Design
- [ ] Add `format`/`format:check`/`lint`/`lint:fix`/`check`/`prepare`
      scripts to `package.json` per Design (exact command strings)
- [ ] Write `.githooks/pre-commit` per Design; `chmod +x
.githooks/pre-commit`
- [ ] Run `git config core.hooksPath .githooks` locally and confirm
      `git config --get core.hooksPath` reports `.githooks`
- [ ] Update `.github/workflows/ci.yml`: insert `bun run format:check` and
      `bun run lint` steps after `bun install --frozen-lockfile`, before the
      existing `typecheck`/`test` steps
- [ ] Run `bun run format` once across the whole repo (baseline reformat) —
      this run is expected and intended to reformat `docs/`, `plans/`, and
      every existing `src/`/`types/`/`.json` file; review the diff before
      committing — it should touch only whitespace/quote/semicolon/
      trailing-comma/prose-wrap style changes, never semantic ones
- [ ] Run `bun run format:check` — confirm zero changes needed (idempotent
      after the baseline reformat)
- [ ] Run `bun run lint` — fix any findings (expected: none beyond what
      `no-explicit-any`/`consistent-type-definitions`/
      `consistent-type-imports` might catch in Phase 01's placeholder files;
      there should be no `any`/`interface` usage yet)
- [ ] Run `bun run typecheck` and `bun test` — confirm both still pass after
      the baseline reformat
- [ ] Make a throwaway local commit attempt with one intentionally
      unformatted `.ts` line and one intentional lint error (e.g. an
      `interface` declaration or an `any`); confirm the pre-commit hook
      blocks the commit; then fix and confirm it succeeds (manual
      verification, not a checked-in test)
- [ ] Update `CLAUDE.md`'s Commands section: replace the `format`/`lint`
      `TBD` markers with the real script names from this phase

## Definition of done

- [ ] `bun run format:check` reports zero changes needed across the entire
      repository
- [ ] `bun run lint` (oxlint) passes with zero errors against the TS7
      sources
- [ ] `bun install` produces no unexpected peer/resolution warnings
- [ ] `bun run typecheck` passes (unaffected by formatting/lint changes)
- [ ] `bun test` passes (unaffected by formatting/lint changes)
- [ ] `.githooks/pre-commit` is present, executable, and actually blocks a
      commit that would leave unformatted or lint-failing files (verified
      manually per Tasks)
- [ ] `core.hooksPath` is set to `.githooks` for this clone, and the
      `prepare` script wires it automatically for future clones
- [ ] `.github/workflows/ci.yml` includes `format:check` and `lint` steps in
      addition to the existing `typecheck`/`test` steps
- [ ] `CLAUDE.md`'s `TBD` script-name markers for format/lint are resolved
- [ ] `docs/plans/TRACK.md` updated: Phase 02 row `[~]` at start, `[x]` at
      completion

## Open questions

- Exact resolved versions of `prettier` and `oxlint` are not known at
  plan-authoring time — resolve via `bun add --exact` during implementation
  and record them in this file's Design section before marking the phase
  done; do not guess or backfill a version number here.
- Whether Bun's `prepare` lifecycle script reliably runs on every `bun
install` invocation (including CI's `--frozen-lockfile` install) in the
  pinned `1.3.14` version should be confirmed during implementation; if it
  does not fire in CI, that is harmless (CI does not rely on git hooks —
  `format:check`/`lint` are explicit CI steps, not hook-dependent), but
  confirm local-clone behavior manually per the Tasks checklist regardless.
