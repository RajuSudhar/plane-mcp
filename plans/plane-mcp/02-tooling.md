# feat-tooling

Phase: 02  |  Status: [ ] planned
Depends on: 01-scaffold
Ref: `plans/plane-mcp/00-rfc.md`, `docs/CODING-STANDARDS.md`, `CLAUDE.md`

## Goal

Establish the formatting/linting baseline — Prettier as the single formatter
for every file type (`.ts`, `.json`, `.md`), ESLint (flat config) +
typescript-eslint for `.ts` correctness, a zero-dependency committed
pre-commit hook, and CI gating — then reformat the entire existing tree
against it in this same commit, so no future feature phase ever produces a
retroactive "format the whole repo" commit that pollutes git history.

**Locked decisions (do not re-litigate — see orchestrator's resolved
decisions)**:

- **Prettier is the single formatter for all file types.** No Biome. One
  formatter config (with per-language `overrides`) covers `.ts`, `.json`,
  and `.md` alike.
- **ESLint owns `.ts` correctness only**, via flat config
  (`eslint.config.ts`) + `typescript-eslint`, with `eslint-config-prettier`
  loaded last so ESLint never fights Prettier over formatting rules. ESLint
  does not lint `.json` or `.md`.
- **Pre-commit hook** is a committed, zero-dependency shell script at
  `.githooks/pre-commit`, wired via `git config core.hooksPath .githooks`.
  It runs Prettier across the whole repo, then ESLint, before every commit.
  `--no-verify` is never used anywhere in this repo (hard rule).

## In scope

- Exact-pinned devDeps: `prettier`, `eslint`, `typescript-eslint`,
  `@eslint/js`, `eslint-config-prettier` (added via `bun add --exact --dev`,
  versions resolved at implementation time — see Open questions).
- `.prettierrc` (or `prettier.config.ts`) — base formatting options matching
  `docs/CODING-STANDARDS.md`'s Formatting Standards, plus an `overrides`
  block giving correct per-language settings for `*.md` and `*.json`.
- `.prettierignore` — `node_modules`, `bun.lock`.
- `eslint.config.ts` (flat config) — `@eslint/js` recommended +
  `typescript-eslint` recommended, the three hard-rule enforcements below,
  `eslint-config-prettier` last, an `ignores` block, scoped to `.ts` only.
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
- Type-aware ESLint rules (rules that require `parserOptions.project` and a
  full type-check pass). The three hard-rule enforcements in this phase
  (`consistent-type-definitions`, `no-explicit-any`,
  `consistent-type-imports`) are all syntactic, non-type-aware rules — no
  `languageOptions.parserOptions.project` wiring is required to enforce
  them. Type-aware linting is a future phase's decision if ever needed.

## Design

### `package.json` devDependencies (additive to Phase 01's block)

```json
{
  "devDependencies": {
    "@types/bun": "1.3.14",
    "typescript": "7.0.2",
    "prettier": "<RESOLVE_EXACT_AT_IMPLEMENTATION>",
    "eslint": "<RESOLVE_EXACT_AT_IMPLEMENTATION>",
    "typescript-eslint": "<RESOLVE_EXACT_AT_IMPLEMENTATION>",
    "@eslint/js": "<RESOLVE_EXACT_AT_IMPLEMENTATION>",
    "eslint-config-prettier": "<RESOLVE_EXACT_AT_IMPLEMENTATION>"
  }
}
```

**IMPORTANT**: every `<RESOLVE_EXACT_AT_IMPLEMENTATION>` placeholder is not a
version to type literally. Run
`bun add --exact --dev prettier eslint typescript-eslint @eslint/js eslint-config-prettier`,
let Bun resolve the actual latest stable versions (per `bunfig.toml`'s
`[install] exact = true`, Bun writes them in without a range), then copy
whatever exact versions land in `package.json` into this file's Design
section before marking this phase done — per `docs/CODING-STANDARDS.md` §
Dependency Management, verify every package against the compromised-package
list before adding.

**CRITICAL — TypeScript 7 compatibility gate**: this repo pins
`typescript@7.0.2` (Phase 01). `typescript-eslint` (and its
`@typescript-eslint/*` sub-packages, pulled in transitively) declare a
`typescript` peerDependency range. If the version of `typescript-eslint`
that resolves at implementation time does not yet list TypeScript 7 in its
supported peer range:

1. Do **not** silently downgrade `typescript` back to a 5.x/6.x line to
   satisfy the peer range — that would violate the Phase 01 scaffold
   decision and `CLAUDE.md`'s pinned-runtime rule.
2. Do **not** silently install a mismatched `typescript-eslint` version and
   ignore the peer-dependency warning.
3. Instead: report the incompatibility (exact `typescript-eslint` version
   tried, its declared peer range, the installed `typescript` version)
   before proceeding, and treat the resolution (wait for a compatible
   `typescript-eslint` release, use a documented prerelease/canary tag that
   explicitly claims TS7 support, or escalate for a scoped decision) as a
   blocking open question for this phase, not a thing to paper over with a
   silent substitution.

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

### `eslint.config.ts`

```typescript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['node_modules', 'bun.lock', '**/*.md', '**/*.json'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  eslintConfigPrettier,
);
```

**Rule-by-rule mapping to the project's hard rules**
(`docs/CODING-STANDARDS.md` / `CLAUDE.md`):

| ESLint rule | Hard rule enforced |
| --- | --- |
| `@typescript-eslint/consistent-type-definitions: ["error", "type"]` | "`type` only, never `interface`" |
| `@typescript-eslint/no-explicit-any: "error"` | "No `any`" |
| `@typescript-eslint/consistent-type-imports: "error"` | Type-only imports (matches the Import Organization convention: "Type imports (separate)") |

**CRITICAL — `eslint-config-prettier` must be the last entry** in the
config array. `tseslint.config(...)` flattens its arguments in order and
later entries override earlier ones for the same rule key;
`eslint-config-prettier` turns off every core-ESLint and
`@typescript-eslint` formatting-related rule so ESLint never reports (or
auto-fixes) something Prettier already owns. If any config item is added
after `eslintConfigPrettier` in a future phase, that is a bug — formatting
rules could silently re-enable.

**Ignores**: `node_modules`, `bun.lock`, `**/*.md`, `**/*.json` — ESLint
targets `.ts` only in this repo; Markdown and JSON have no lint step (they
are formatted-only, by Prettier). `.githooks/pre-commit` is a `.sh` file and
is naturally untouched by either tool without needing an explicit ignore
entry.

**Note on `interface` exceptions**: `consistent-type-definitions` set to
`"type"` will flag any `interface` declaration, including the two narrow
exceptions `docs/CODING-STANDARDS.md` allows (class-extends,
declaration-merging). If a future phase hits one of those two legitimate
cases, use a scoped
`// eslint-disable-next-line @typescript-eslint/consistent-type-definitions`
comment with a one-line reason, rather than loosening the rule globally.

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
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
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
- `lint` — `eslint .` reports lint errors (scoped to `.ts` via
  `eslint.config.ts`'s own file matching/ignores), exits non-zero on any,
  mutates nothing.
- `lint:fix` — `eslint . --fix` applies ESLint's safe auto-fixes.
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

echo "[pre-commit] Linting (eslint)..."
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
          bun-version: "1.3.14"
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
file again.

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

- [ ] `bun add --exact --dev prettier eslint typescript-eslint @eslint/js eslint-config-prettier`;
      verify each package against the compromised-package list; record the
      resolved exact versions in this file's Design section
- [ ] Verify the resolved `typescript-eslint` version's peer-dependency
      range actually supports the installed `typescript@7.0.2` — if it does
      not, stop and resolve per the CRITICAL note in Design (report before
      substituting) rather than silently downgrading TypeScript or ignoring
      the peer warning
- [ ] Write `.prettierrc` per Design
- [ ] Write `.prettierignore` per Design
- [ ] Write `eslint.config.ts` per Design
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
- [ ] `bun run lint` passes with zero errors
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

- Exact resolved versions of `prettier`, `eslint`, `typescript-eslint`,
  `@eslint/js`, and `eslint-config-prettier` are not known at
  plan-authoring time — resolve via `bun add --exact` during implementation
  and record them in this file's Design section before marking the phase
  done; do not guess or backfill a version number here.
- Whether the resolved `typescript-eslint` version's declared peer range
  covers `typescript@7.0.2` must be confirmed at implementation time — see
  the CRITICAL note in Design. If it lags TypeScript 7, this is a blocking
  finding to report (with the exact versions and peer range involved)
  before any substitution is made, not a silent downgrade.
- Whether Bun's `prepare` lifecycle script reliably runs on every `bun
  install` invocation (including CI's `--frozen-lockfile` install) in the
  pinned `1.3.14` version should be confirmed during implementation; if it
  does not fire in CI, that is harmless (CI does not rely on git hooks —
  `format:check`/`lint` are explicit CI steps, not hook-dependent), but
  confirm local-clone behavior manually per the Tasks checklist regardless.
- Whether `eslint.config.ts` (a TypeScript flat-config file) loads correctly
  under the resolved ESLint version without an extra loader/runtime
  dependency (modern ESLint has native/`jiti`-backed TS config support in
  recent major versions) must be confirmed at implementation time; if the
  resolved ESLint version cannot load a `.ts` config file directly, that is
  a blocking finding to report — do not silently rename the config to
  `eslint.config.js` /`.mjs` without flagging the deviation, since the
  resolved decision explicitly specifies `eslint.config.ts`.
