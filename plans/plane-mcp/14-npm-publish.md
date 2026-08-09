# feat-npm-publish

Phase: 14 | Status: [x] done
Depends on: 13-test-type-safety
Ref: `package.json`, `.npmignore`, `LICENSE`, `README.md`, `docs/plans/TRACK.md`

## Goal

Prepare the package for npm publish as a Bun-native `bunx plane-mcp`
command. The package name `plane-mcp` is available on npm. No actual
publish step is taken; this phase gates the readiness.

## In scope

- `package.json`: remove `"private": true`, add publish metadata
  (description, license, keywords, engines, publishConfig, files,
  repository), guard `prepare` script for no-git environments, add
  `prepublishOnly` gate script.
- `.npmignore`: exclude test files and dev stubs to keep the tarball
  lean.
- `LICENSE`: add MIT license file (Copyright 2026 Sudharsan).
- `README.md`: add "Install from npm (Bun)" section documenting
  `bunx plane-mcp` and client configuration.
- `plans/plane-mcp/14-npm-publish.md`: phase documentation (this file).
- `docs/plans/TRACK.md`: add Phase 14 row, update decisions-log.
- Verification: `npm pack --dry-run` with full tarball contents inspection
  to confirm only src/, types/, README.md, LICENSE, and package.json are
  shipped (no test files, no docs/, no deploy/, no .github/, etc.).

## Out of scope

- Actual `npm publish` or `bun publish` (user's step after review).
- Node/CommonJS build path (Path B in alternatives; Bun-native only).
- CI/CD automation for publish (e.g., release workflows, version bumping).

## Design

### Why publish now

The codebase is feature-complete (31 tools), type-safe (no `as unknown as`),
type-aware linting enabled, tested (117 assertions), documented (README, ARCHITECTURE),
and distribution-ready (stdio + HTTP transports). No npm-specific blockers remain.
The name `plane-mcp` is available. A published package allows users to `bunx plane-mcp`
without cloning or running `bun link` locally.

### Bun-native, not Node

`plane-mcp` requires Bun 1.3.14+. The bin entries (`src/stdio.ts`, `src/index.ts`)
are TypeScript files that run natively under Bun via the shebang `#!/usr/bin/env bun`.
No JavaScript build step is needed; `bun` in the shebang is the runtime.

Consumers must have Bun installed. This is a hard dependency, not a fallback path.
Node-only users would need a separate CommonJS/JavaScript build (out of scope;
could be a future Path B if demanded).

### `package.json` changes

- **Remove `"private": true`**: makes the package publishable to npm.
- **Add `description`**: human-readable purpose (MCP server + transports).
- **Add `license: "MIT"`**: declares the license.
- **Add `keywords`**: searchability (mcp, model-context-protocol, plane, bun, typescript).
- **Add `engines: { "bun": ">=1.3.14" }`**: declares Bun as a runtime engine dependency
  (npm/yarn display this in installation warnings).
- **Add `publishConfig: { "access": "public" }`**: ensures the package is published
  as a public registry entry (explicit, even though the default is public for unscoped
  packages; defensive).
- **Omit `files` field**: npm-controlled allowlist would normally control tarball contents,
  but testing showed this npm version does not suppress test files when `files` is present.
  Instead, `.npmignore` (`**/*.test.ts` + `src/tools/client-stub.ts`) is the effective control.
- **Add `repository`**: points to the GitHub repo (`git+https://github.com/RajuSudhar/plane-mcp.git`).
- **Fix `prepare` script**: append `|| true` so it does not fail in environments where
  git is not available or `.githooks` does not exist (e.g., post-npm-install, CI without
  git checkout). Format: `"prepare": "git config core.hooksPath .githooks || true"`.
- **Add `prepublishOnly` script**: runs full gate before publish attempt
  (`typecheck && check && test`). This runs only when `npm publish` is invoked
  (not on every `npm install`), ensuring the published tarball passes all checks.

### `.npmignore`

Even though `files` includes `src/` and `types/`, `.npmignore` explicitly excludes
dev/test artifacts:

```
**/*.test.ts
src/tools/client-stub.ts
```

The `files` allowlist already excludes (via directory structure) `plans/`, `docs/`,
`deploy/`, `scripts/`, `.github/`, `.env*`, `bunfig.toml`, `.githooks`, `.oxlintrc.json`.
Confirm with `npm pack --dry-run` that these do not appear in the tarball.

### `LICENSE` file

Standard MIT license, Copyright 2026 Sudharsan. Placed at repo root for npm
to discover and include automatically.

### `README.md` addition

Add an "## Install from npm (Bun)" section after "## Install" and before "## Configure",
documenting:

- `bunx plane-mcp` as the primary invocation (no local clone needed).
- `bun add -g plane-mcp` as an alternative global install.
- MCP client config example using `bunx`.
- Note that the package is Bun-native (consumers need Bun, not just Node).
- Mention HTTP mode as an alternative.

### Full file list

- `package.json` — 7 new fields, 2 script edits, no dependency changes
- `.npmignore` — 2 exclusion lines
- `LICENSE` — 18 lines (standard MIT header + copyright)
- `README.md` — ~30 line addition (Install from npm section)
- `plans/plane-mcp/14-npm-publish.md` — this file
- `docs/plans/TRACK.md` — Phase 14 row + decisions-log entry

## Tasks

- [x] Remove `"private": true` from `package.json`
- [x] Add `description`, `license`, `keywords`, `engines`, `publishConfig`,
      `files`, `repository` to `package.json`
- [x] Update `prepare` script to `"git config core.hooksPath .githooks || true"`
- [x] Add `prepublishOnly` script to `package.json`
- [x] Create `.npmignore` with `**/*.test.ts` and `src/tools/client-stub.ts`
- [x] Create `LICENSE` file (MIT, Copyright 2026 Sudharsan)
- [x] Add "Install from npm (Bun)" section to `README.md`
- [x] Create `plans/plane-mcp/14-npm-publish.md` (this file)
- [x] Run `bunx tsc --noEmit` — confirm zero errors
- [x] Run `./node_modules/.bin/oxlint` — confirm zero errors
- [x] Run `bun test` — confirm all tests pass
- [x] Run `bunx prettier --check .` — confirm formatting clean
- [x] Run `npm pack --dry-run` and inspect tarball contents
- [x] Confirm `"private"` removed from `package.json`
- [x] Update `docs/plans/TRACK.md`: add Phase 14 row, update decisions-log

## Definition of done

- [x] `package.json` contains all 7 publish metadata fields
- [x] `"private": true` is removed
- [x] `prepare` script is guarded with `|| true`
- [x] `prepublishOnly` gate script is present and runs typecheck + check + test
- [x] `.npmignore` excludes `**/*.test.ts` and `src/tools/client-stub.ts`
- [x] `LICENSE` file exists at repo root with MIT + Copyright 2026 Sudharsan
- [x] `README.md` contains new "Install from npm (Bun)" section (Prettier-clean, printWidth 120)
- [x] `npm pack --dry-run` tarball contents include: - package.json, README.md, LICENSE, src/, types/ - exclude: _.test.ts, src/tools/client-stub.ts, plans/, docs/, deploy/, scripts/,
      .github/, .env_, bunfig.toml, .githooks, .oxlintrc.json
- [x] `bunx tsc --noEmit` passes (exit 0)
- [x] `./node_modules/.bin/oxlint` passes (exit 0)
- [x] `bun test` passes (all 117 assertions)
- [x] `bunx prettier --check .` reports zero formatting changes needed
- [x] No `.js` files emitted or committed
- [x] `docs/plans/TRACK.md` updated with Phase 14 row and decisions-log entry

## Open questions

- **Real `repository` URL**: RESOLVED — the repository URL `git+https://github.com/RajuSudhar/plane-mcp.git`
  is set in `package.json`. No further updates needed before publish.zhs
- **`files` field**: intentionally omitted from `package.json`. Testing with this npm version showed
  that including `files` did not suppress test file shipping; `.npmignore` is the effective control.
  Rely on `.npmignore` (`**/*.test.ts` + `src/tools/client-stub.ts`) to keep the tarball clean.
- **Path B (Node build)**: whether to support Node.js consumers via a separate
  CommonJS/JavaScript build is deferred (out of scope for Phase 14). Revisit
  if npm install questions arise from Node-only users.
- **Publish workflow**: CI/CD automation for npm publish (e.g., release
  tagging, version bumping, GitHub Actions on release) is out of scope.
  User runs `npm publish` manually after review.
