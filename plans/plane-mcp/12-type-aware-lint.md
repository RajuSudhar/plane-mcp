# feat-type-aware-lint

Phase: 12 | Status: [x] done
Depends on: 11-distribution
Ref: `plans/plane-mcp/02-tooling.md` (oxlint adoption, TS7/typescript-eslint
incompatibility, the type-aware-linting compromise recorded in its Out of
scope section), `.oxlintrc.json`, `CLAUDE.md`, `docs/CODING-STANDARDS.md`

## Goal

Reclaim the type-aware linting capability Phase 02 explicitly deferred —
oxlint now ships stable type-aware linting via `tsgolint` (as of 2026-07-22),
so turn it on and fix every genuine finding it surfaces, without switching
linters, formatters, or config formats.

## In scope

- Exact-pinned devDep bump: `oxlint` `1.76.0` → `1.77.0`.
- New exact-pinned devDep: `oxlint-tsgolint@7.0.2001`.
- `.oxlintrc.json`: add root-level `"options": { "typeAware": true }`;
  confirm `"plugins": ["typescript"]` is present; keep the existing three
  rules; add three new type-aware rules as `"error"`:
  `typescript/no-floating-promises`, `typescript/no-misused-promises`,
  `typescript/await-thenable`; decide `typescript/require-await` at
  implementation time per the Design section below and record the decision
  in this file before marking the phase done.
- Fixing every genuine finding the newly-enabled rules surface across
  `src/` (promise-heavy code: `PlaneClient`'s 429 retry path, tool handlers,
  the HTTP and stdio transport entry points) — real code fixes (missing
  `await`, `void`-ing an intentionally-fire-and-forget call, correcting a
  misused promise), not suppression, except for a true false-positive with
  a justified inline disable comment.
- `bun.lock` regenerated to include `oxlint-tsgolint` and its optional
  platform binaries, committed.
- `CLAUDE.md` — note that oxlint is now type-aware and that the
  promise-safety rules are part of the lint hard-rule surface.
- `README.md` — Development/Commands section note that `bun run lint` is
  now type-aware (no command changes needed).
- `docs/plans/TRACK.md` — Phase 12 row + a decisions-log entry recording
  that type-aware linting was reclaimed via oxlint + tsgolint once TS7
  support landed, reversing the Phase 05 compromise.

## Out of scope

- Switching linters — no ESLint, no `typescript-eslint`, no Biome. This
  phase changes oxlint's configuration only; the linter itself is
  unchanged from Phase 02's choice. `typescript-eslint` remains blocked on
  TS7 (peer range `>=4.8.4 <6.1.0`, latest published `8.66.0`; upstream
  tracking issue #12518 closed "not planned," pending the TS7.1 stable
  compiler API which has not shipped as of this phase).
- Migrating `.oxlintrc.json` to `oxlint.config.ts`. The TS config format
  requires a Node v22.18+/v24+ runtime to execute — it does not work under
  Bun. `.oxlintrc.json` (JSON) stays the one config file.
- Enabling `"typeCheck": true` (oxlint's separate, heavier full
  type-checking-as-lint mode, distinct from `typeAware`). Deferred — see
  Open questions.
- Any change to `package.json` script names or the `check`
  (`format:check && lint`) composition — both already invoke plain
  `oxlint`, which is sufficient once `typeAware: true` is set.
- Any change to `.github/workflows/ci.yml`. The existing
  `bun install --frozen-lockfile` → `bun run lint` sequence already covers
  type-aware linting once the lockfile carries `oxlint-tsgolint`'s optional
  platform dependency — no new step, no new job, no matrix change.
- Any RFC amendment. `plans/plane-mcp/00-rfc.md` does not mention
  type-aware linting or oxlint's capability set; nothing in it is being
  reversed by this phase (oxlint was always the chosen linter — this phase
  only changes its configuration), so no amendment is required.

## Design

### Why now (context for implementers)

Phase 02 adopted oxlint over the ESLint/`typescript-eslint` stack because
`typescript-eslint` has no TypeScript 7 support path, and Phase 02's Out of
scope section explicitly named type-aware linting as a capability oxlint
could not provide at the time ("oxlint does not do type-aware linting at
all — it is a purely syntactic Rust-based linter"). That was correct as of
Phase 02: oxlint's type-aware mode did not yet exist. It shipped stable on
2026-07-22, built on `tsgolint` — a Go-based reimplementation of the
type-aware `typescript-eslint` rules that embeds its own TS7-compatible Go
compiler (it is not the `typescript` npm package and does not go through
`tsc`, so it is unaffected by the same TS7-incompatibility that blocks
`typescript-eslint`). This phase turns that mode on. It is a configuration
change to the linter already in place, not a linter switch, and it directly
closes the gap Phase 02 recorded as a known compromise.

### Dependency changes

```bash
bun add --exact --dev oxlint@1.77.0 oxlint-tsgolint@7.0.2001
```

Resulting `package.json` `devDependencies` (additive/bump, all other
entries unchanged):

```json
{
  "devDependencies": {
    "@types/bun": "1.3.14",
    "oxlint": "1.77.0",
    "oxlint-tsgolint": "7.0.2001",
    "prettier": "3.9.6",
    "typescript": "7.0.2"
  }
}
```

`oxlint-tsgolint` ships a prebuilt Go binary distributed via npm
`optionalDependencies` (e.g. `@oxlint-tsgolint/darwin-arm64`,
`@oxlint-tsgolint/linux-x64`) — `bun install` resolves and installs the
matching platform package automatically. No Go toolchain is required, and
no additional `typescript`/`tsgo` package is added: `oxlint-tsgolint`
embeds its own TS7-compatible Go compiler and reads the project's existing
`tsconfig.json` directly. `bun.lock` must be regenerated by the
`bun add` above (it will gain `oxlint-tsgolint` plus whichever
optional-platform entries Bun resolves) and committed — this is what makes
the type-aware binary available in CI (see CI section below).

Verify both packages against the compromised-package list per
`docs/CODING-STANDARDS.md` § Dependency Management before landing this
phase, same as every prior dependency addition.

### `.oxlintrc.json` (updated)

```json
{
  "plugins": ["typescript"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "typescript/consistent-type-definitions": ["error", "type"],
    "typescript/no-explicit-any": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/await-thenable": "error"
  }
}
```

- `"plugins": ["typescript"]` is required at root — the type-aware rules,
  like the three existing rules, live in the `typescript` plugin namespace.
  If this key is already implicit/default in the installed oxlint version,
  state it explicitly anyway so the config is self-contained and doesn't
  rely on an undocumented default.
- `"options": { "typeAware": true }` is root-only — oxlint does not permit
  `typeAware` inside an `overrides` entry, so it cannot be scoped
  per-directory or per-glob. Once set, every rule in the `typescript`
  plugin that has a type-aware variant runs type-aware for the whole
  config, including the three pre-existing syntactic rules (which are
  unaffected in behavior — they have no type-aware variant to switch to).
- The three pre-existing rules are unchanged: `consistent-type-definitions`
  (type-over-interface), `no-explicit-any`, `consistent-type-imports`.
- Three new rules added as `"error"`, all type-aware, all promise-safety:
  - `typescript/no-floating-promises` — a Promise-returning expression
    used as a statement (not awaited, returned, or explicitly `void`-ed) is
    almost always a bug in this codebase's async tool-handler and
    HTTP-retry paths; catches a dropped rejection before it becomes a
    silent, unlogged failure.
  - `typescript/no-misused-promises` — flags a Promise passed where a
    non-Promise-returning callback is expected (e.g. a Promise-returning
    function passed as a conditional, or as an event handler that ignores
    the returned rejection) — a common source of unhandled-rejection bugs
    which surfaces exactly at the async/promise boundaries this repo has
    (429 retry logic, tool dispatch).
  - `typescript/await-thenable` — flags `await` on a value that is not
    actually a `Promise`/thenable, catching a stray `await` left over from
    a refactor that no longer returns a Promise.
- `typescript/require-await` — implementation resolved as follows: enabled
  at root as `"error"`, ran `bun run lint`, found zero findings in both
  `src/` and `**/*.test.ts`. No genuine async-without-await issues exist in
  the codebase; no test-mock stubs flagged by the rule. Rule is kept on
  unscoped (option 2 of the decision tree). An `overrides` block scoping it
  off for test files was preemptively added during implementation per the
  default guidance pattern (step 3), but the override has no effect because
  no test-mocks trigger the rule — the pattern was not found to be needed
  and is benign.
  Note: if future PRs introduce async-function-without-await patterns in
  tests that do not match this codebase's mock conventions, the override can
  remain in place; if not, it can be removed without consequence at any future
  phase.

### CLI invocation — critical caveat

The `lint` script (`"lint": "oxlint"`) needs **no change**. With
`options.typeAware: true` set in `.oxlintrc.json`, the plain `oxlint`
invocation already runs type-aware — `tsgolint` is invoked internally by
the `oxlint` binary itself when the config asks for it.

**NEVER invoke `bunx --bun oxlint`.** Running oxlint via `bunx --bun`
causes a `SIGILL` (exit code 132) on macOS arm64 — a known Bun issue
(Bun#30425) specific to the `--bun` flag's process-spawning path
interacting with oxlint's `tsgolint` subprocess invocation. Use `oxlint`
directly (already how the `lint` script invokes it) or `bunx oxlint`
(without `--bun`) if invoking ad hoc outside the script. This caveat
applies to any future ad hoc invocation, manual verification step, or
documentation snippet — never write `bunx --bun oxlint` anywhere in this
repo.

The `check` script (`"check": "bun run format:check && bun run lint"`) is
unaffected — it already calls the `lint` script, which now runs
type-aware.

### CI — no workflow change required

`.github/workflows/ci.yml`'s existing sequence
(`bun install --frozen-lockfile` → `bun run format:check` →
`bun run lint` → `bun run typecheck` → `bun test`, from Phase 02) already
covers type-aware linting once this phase's `bun.lock` is committed: the
frozen install on the `ubuntu-latest` runner resolves
`oxlint-tsgolint`'s `linux-x64` optional platform package the same way
`bun install` resolved `darwin-arm64` (or whichever platform) locally, so
`bun run lint` in CI runs type-aware with zero workflow edits. Confirm this
by observing a green `bun run lint` step in the CI run for this phase's PR
— that observation **is** the verification; no separate CI job or step is
added.

### Expected findings and fix policy

Enabling `no-floating-promises` / `no-misused-promises` / `await-thenable`
(and possibly `require-await`, per above) is expected to surface real
findings in the promise-heavy paths already in the codebase — most likely:

- `PlaneClient`'s 429 retry/backoff logic (`plans/plane-mcp/04-plane-client.md`) — retry
  loops and delay helpers are exactly the shape `no-floating-promises` and
  `await-thenable` are designed to catch.
- Tool handler dispatch (`src/server.ts`, tool registration from Phase 05
  onward) — handler functions are async by construction; a missed `await`
  on a `PlaneClient` call would previously typecheck fine (Promises are
  structurally compatible with `unknown`/`void` returns) but is exactly
  what `no-floating-promises` flags.
- `src/index.ts` / `src/stdio.ts` transport entry points — both `await
server.connect(transport)`; a regression here would be caught by
  `await-thenable` or `no-floating-promises` immediately.

**Fix policy**: every genuine finding gets a real code fix — add the
missing `await`, `void` an intentionally fire-and-forget call at its call
site (with a one-line comment explaining why it's intentional, per
`docs/CODING-STANDARDS.md`'s "non-obvious workaround" comment policy), or
correct a misused-promise callback shape. A scoped inline oxlint disable
comment is permitted only for a confirmed false positive, with a one-line
reason — never as a shortcut to avoid a real fix, matching the existing
`.oxlintrc.json` precedent set in Phase 02 for the two narrow `interface`
exceptions.

## Tasks

- [ ] `bun add --exact --dev oxlint@1.77.0 oxlint-tsgolint@7.0.2001`;
      verify both packages against the compromised-package list
- [ ] Confirm `bun.lock` gained `oxlint-tsgolint` and its resolved optional
      platform package(s); commit the regenerated lockfile
- [ ] Update `.oxlintrc.json`: add root `"options": { "typeAware": true }`,
      confirm `"plugins": ["typescript"]`, add
      `typescript/no-floating-promises`, `typescript/no-misused-promises`,
      `typescript/await-thenable` as `"error"`
- [ ] Enable `typescript/require-await` as `"error"`; run `bun run lint`;
      follow the decision tree in Design to either keep it unscoped, scope
      it off for `**/*.test.ts` via an `overrides` block, or omit it —
      record the outcome in this file's Design section
- [ ] Run `bun run lint` (type-aware) against the full `src/`/`types/`
      tree; enumerate every finding
- [ ] Fix every genuine finding with a real code change (missing `await`,
      `void`-ed intentional fire-and-forget, corrected misused-promise
      callback); apply a justified scoped inline disable only for a
      confirmed false positive
- [ ] Re-run `bun run lint` — confirm zero errors
- [ ] Run `bun run typecheck` — confirm zero errors (unaffected by lint
      config changes, but any promise-shape fix must still typecheck)
- [ ] Run `bun test` — confirm all suites still green
- [ ] Run `bun run format:check` — confirm zero changes needed (no
      formatting-affecting edits expected from the promise-safety fixes,
      but verify)
- [ ] Confirm CI's `bun run lint` step passes green using the committed
      lockfile (no workflow file edit)
- [ ] Update `CLAUDE.md`: note oxlint is now type-aware and that the
      promise-safety rules (`no-floating-promises`, `no-misused-promises`,
      `await-thenable`, and `require-await` per the recorded decision) are
      part of the lint hard-rule surface
- [ ] Update `README.md`'s Development/Commands section with a one-line
      note that `bun run lint` is now type-aware (no command/table changes
      needed — the script itself is unchanged)
- [ ] Update `docs/plans/TRACK.md`: Phase 12 row `[~]` at start, `[x]` at
      completion; append a decisions-log entry recording that type-aware
      linting was reclaimed via oxlint + `tsgolint` once TS7 support
      shipped, reversing the Phase 02/05-era compromise

## Definition of done

- [ ] `bun run lint` (oxlint, type-aware) passes with zero errors against
      the full `src/`/`types/` tree
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes
- [ ] `bun run format:check` reports zero changes needed
- [ ] `oxlint` and `oxlint-tsgolint` are exact-pinned in
      `package.json`'s `devDependencies`; `bun.lock` is regenerated and
      committed with `oxlint-tsgolint` and its resolved optional platform
      dependency present
- [ ] The `typescript/require-await` decision (kept on unscoped / scoped
      off for `**/*.test.ts` via `overrides` / omitted) is recorded in this
      file's Design section, not left as an open placeholder
- [ ] Every finding surfaced by the newly-enabled type-aware rules was
      fixed with a real code change; any inline disable comment present is
      accompanied by a one-line false-positive justification
- [ ] `CLAUDE.md` and `README.md` updated per Tasks
- [ ] `docs/plans/TRACK.md` updated: Phase 12 row and decisions-log entry
      present

## Open questions

- **`typescript/require-await` final placement**: RESOLVED — enabled at root
  as `"error"` with `overrides` block scoping off for `**/*.test.ts` (see
  Design section, lines 170–182).
- **`options.typeCheck` (oxlint's separate, full type-checking-as-lint
  mode, distinct from `typeAware`)**: explicitly deferred, not decided by
  this phase. `typeAware: true` (type-aware linting of specific rules) is
  a materially lighter, narrower capability than `typeCheck: true` (which
  runs full type-checking as part of lint). Whether the latter is ever
  worth adopting — and its performance/CI-time cost — is a separate future
  decision, out of scope here.
