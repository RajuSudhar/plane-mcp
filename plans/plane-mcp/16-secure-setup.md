# feat-secure-setup

Phase: 16 | Status: [x] done (Pass 4: examples relocated, docs rewritten)
Depends on: 15-local-service, 14-npm-publish
Ref: `plans/plane-mcp/00-rfc.md` (amended 2026-08-07), `src/config.ts`, `src/stdio.ts`, `src/index.ts`,
`package.json`, `README.md`, `docs/plans/TRACK.md`, `.npmignore`

## Goal

Replace "paste `PLANE_API_KEY` into the MCP client config" with "provide the secret once at
`plane-mcp init <name>`, store it in the OS credential store, resolve it by instance name at
runtime" — and support multiple named local installs (one per Plane workspace) on the same
machine without collision.

## In scope

- New cross-platform secrets module `src/secrets.ts` (+ types in `types/secrets.ts`): write,
  read, delete a secret keyed by an instance name, backed by the OS credential store where one
  exists and a `0600` file fallback where it does not.
- `plane-mcp init <name>` CLI command: prompts for the API key with hidden input, stores it via
  the secrets module, prints a ready-to-paste MCP server config block with no key in it, and
  optionally registers the server with `claude mcp add` via `--register`.
- `src/config.ts` `loadAuthContext` gains a keychain-backed resolution path, selected via
  `PLANE_MCP_INSTANCE`, with the existing `PLANE_API_KEY` env path kept as the first-checked
  fallback.
- `bin.plane-mcp` becomes a small dispatcher: `plane-mcp init ...` runs the setup command,
  anything else runs the stdio transport exactly as today.
- Multi-instance support: N independent `plane-mcp init <name>` runs, N independent keychain
  entries, N independent `plane-<name>` MCP server configs, zero shared state between them.
- Relocation of the (uncommitted) Phase 15 macOS launchd artifacts from repo-root `scripts/` /
  `deploy/` into `examples/macos-launchd/`, generalized to be env-driven rather than hardcoded
  to one user's workspace/port, with `.npmignore` updated to exclude `examples/`.
- Unit tests: secrets module (mocked command runner, no real keychain access), config resolver
  (all three resolution branches), `init`'s printed-config output (asserting the key is absent).
- Docs: README "Setup" section rewritten around `plane-mcp init`; `examples/macos-launchd/`
  documented as the optional macOS persistence add-on; CLAUDE.md auth-resolution-order note.

## Out of scope

- A full interactive TUI for setup (single-shot prompt only, no multi-screen wizard).
- Secret rotation, `plane-mcp remove <name>` / `plane-mcp logout <name>`, and `plane-mcp init
--list` beyond a one-line "planned" mention in `--help` output — see Open questions.
- Non-OS secret managers (1Password CLI, Vault, etc.) as a storage backend.
- Bundling the secret into the printed or `claude mcp add`-registered MCP config in any form —
  the printed config is byte-for-byte free of the API key, always.
- Linux/Windows persistent-service equivalents of Phase 15's launchd service (macOS-only
  artifact, relocated as-is in spirit, not reimplemented for other platforms).
- Changing the HTTP transport (`src/index.ts`, `plane-mcp-http` bin) — this phase touches the
  stdio entry point and `loadAuthContext` only; HTTP keeps its existing single-`AuthContext`
  startup path (an operator running the HTTP server under a launchd-style supervisor still sets
  `PLANE_API_KEY` directly, or exports it from the same secrets module in a wrapper script —
  wiring the HTTP entry to `PLANE_MCP_INSTANCE` directly is deferred, not precluded).

## Design

### `src/secrets.ts` + `types/secrets.ts`

```typescript
// types/secrets.ts
type SecretBackend = 'macos-keychain' | 'linux-secret-service' | 'file-fallback';

type SecretResult = { ok: true; backend: SecretBackend } | { ok: false; backend: SecretBackend; error: string };

type SecretReadResult =
  { ok: true; value: string; backend: SecretBackend } | { ok: false; backend: SecretBackend; error: string };

type CommandRunner = (cmd: string, args: string[], stdin?: string) => Promise<CommandResult>;

type CommandResult = { exitCode: number; stdout: string; stderr: string };
```

`src/secrets.ts` exports `writeSecret(name, value, runner?)`, `readSecret(name, runner?)`,
`deleteSecret(name, runner?)`, each keyed by `plane-mcp/<name>`. `runner` defaults to a real
`Bun.spawn`-backed implementation and is the injection point tests use to avoid touching the
real OS store (same DI shape as `FetchLike` in `types/client.ts` — inject the side-effecting
primitive, never mutate a global).

Backend selection is by `process.platform`:

- **macOS (`darwin`)** — real Keychain via `security`. Write: `security add-generic-password -U
-a "$USER" -s "plane-mcp/<name>" -w <secret>`. Read: `security find-generic-password -a
"$USER" -s "plane-mcp/<name>" -w`. Delete: `security delete-generic-password -a "$USER" -s
"plane-mcp/<name>"`. `-U` makes writes idempotent (update in place instead of erroring on a
  duplicate entry) — needed because re-running `init <name>` with the same name must overwrite,
  not fail.
- **Linux** — real Secret Service via `secret-tool` (libsecret), when present on `PATH`. Write:
  `secret-tool store --label="plane-mcp/<name>" service plane-mcp account <name>` with the
  secret piped on stdin (never as an argv value — argv is visible in `ps`). Read: `secret-tool
lookup service plane-mcp account <name>`. Delete: `secret-tool clear service plane-mcp account
<name>`. If `secret-tool` is not on `PATH` (headless/no D-Bus session, common on servers and
  minimal distros), fall through to the file fallback and record `backend: 'file-fallback'` in
  the result so `init` can print a one-line notice.
- **Windows** — **honest caveat, not a full native implementation**: `cmdkey /generic:plane-mcp/<name>
/user:plane-mcp /pass:<secret>` can _write_ a Credential Manager entry, but `cmdkey` has no
  read-back command — Windows provides no CLI that returns a stored generic credential's
  password in plaintext (`cmdkey /list` shows metadata only). A robust read requires PowerShell
  - DPAPI (`CredentialManager` module or P/Invoke `CredRead`), which is out of scope for a
    no-npm-dependency, shell-out-only module in this phase. Windows therefore uses the file
    fallback unconditionally, and the plan records this as a known limitation rather than
    papering over it with an unverified `cmdkey` read path. Revisit with a dedicated Windows RFC
    if native Credential Manager read support becomes a priority.
- **Generic file fallback** (used for Windows always, Linux when `secret-tool` is absent, and
  any platform where the native path errors) — `~/.config/plane-mcp/credentials`, a JSON map of
  `{ [name]: secretValue }`, written with mode `0600` (best-effort `chmod` on Windows, where
  POSIX permission bits do not apply the same way — documented as a residual risk, not silently
  claimed as secure).

Hard rules for `src/secrets.ts`: never `log()` a secret value (only instance names, backend
names, exit codes); resolve tool paths via `Bun.which('security' | 'secret-tool')` where
practical rather than assuming `PATH` always resolves the same binary; every exported function
returns one of the typed result unions above — never throws for an expected "backend
unavailable" or "not found" condition (callers branch on `ok`), reserving thrown errors for
programmer misuse (e.g., empty `name`).

### `plane-mcp init <name>` CLI

New `src/cli/init.ts` (or `src/cli/` module, exact file name is an implementation detail for
Phase 16's own task list) implements the command. Args:

| Arg / flag           | Required | Default                | Notes                                                                                   |
| -------------------- | -------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `<name>`             | yes      | —                      | instance label, e.g. `breeze`, `juspay`                                                 |
| `--workspace <slug>` | yes      | —                      | `PLANE_WORKSPACE_SLUG` value to print                                                   |
| `--base-url <url>`   | no       | `https://api.plane.so` | must be `https://`                                                                      |
| `--port <n>`         | no       | —                      | only relevant if the user later runs the HTTP entry; printed as a comment, not required |
| `--register`         | no       | off                    | also runs `claude mcp add` after printing                                               |

Flow:

1. Validate `<name>` (non-empty, safe for a keychain service-name segment — reject whitespace
   and `/`) and `--base-url` (`https://` prefix, same rule `loadAuthContext` already enforces).
2. Prompt for the API key with hidden input (no terminal echo) — Bun's stdin raw-mode read, no
   new dependency.
3. Call `writeSecret(name, apiKey)`. Non-`ok` result aborts with a clear error and non-zero
   exit; the key is never logged in either branch.
4. Print — to stdout, since this is an interactive CLI output, not the MCP JSON-RPC stream —
   a ready-to-paste config block:

   ```json
   {
     "mcpServers": {
       "plane-<name>": {
         "command": "plane-mcp",
         "env": {
           "PLANE_MCP_INSTANCE": "<name>",
           "PLANE_WORKSPACE_SLUG": "<slug>",
           "PLANE_BASE_URL": "<url>"
         }
       }
     }
   }
   ```

   `PORT` is included only if `--port` was passed. The API key never appears in this output —
   this is a Definition-of-done item, not a best-effort goal, and the printed-config test
   asserts it with a string-search over the exact stdout.

5. If `--register`: shell out to `claude mcp add --scope user plane-<name> --env
PLANE_MCP_INSTANCE=<name> --env PLANE_WORKSPACE_SLUG=<slug> --env PLANE_BASE_URL=<url> --
plane-mcp` (append `--env PORT=<n>` if `--port` was passed). If the `claude` binary is not on
   `PATH`, print the config block (already done in step 4) and a note to add it manually — do
   not fail the whole `init` run over a missing optional CLI.
6. `plane-mcp init --list` and `plane-mcp init remove <name>` / `plane-mcp logout <name>` are
   **not implemented this phase** — `init --help` prints a one-line "planned" note so the CLI
   surface documents its own roadmap without shipping the extra command surface. See Open
   questions.

### `bin` dispatcher

`package.json`'s `bin.plane-mcp` currently points straight at `src/stdio.ts`. It becomes a thin
dispatcher (new `src/cli.ts`, `bin.plane-mcp: "./src/cli.ts"`):

```typescript
#!/usr/bin/env bun
const [command, ...rest] = Bun.argv.slice(2);

if (command === 'init') {
  await runInit(rest);
} else {
  await import('./stdio');
}
```

`src/stdio.ts` itself is otherwise unchanged — the dispatcher `import`s it for the default path
rather than duplicating its body. `bin.plane-mcp-http` (`src/index.ts`) is untouched.

### Config resolver (`src/config.ts`)

`loadAuthContext` gains a keychain branch and becomes `async` (its two current callers,
`src/stdio.ts` and `src/index.ts`, both already sit at module top level and can `await` it
directly — this is a mechanical signature change, not a design change, and is called out
explicitly here since it is easy to miss: **every current and future call site of
`loadAuthContext` must be updated to `await` it**, and any code that assumed a synchronous
return needs re-auditing during implementation).

Resolution order:

1. `process.env.PLANE_API_KEY` — if set, used as-is (unchanged; this is the env/CI/dev-fallback
   path and always wins if present, so CI never touches the keychain).
2. Else, if `process.env.PLANE_MCP_INSTANCE` is set: `readSecret(instance)`. `ok: true` → use
   `value` as the API key. `ok: false` → throw a clear error naming the instance and pointing at
   `plane-mcp init <name>` (not a generic "key missing" message).
3. Else: throw an error stating neither `PLANE_API_KEY` nor `PLANE_MCP_INSTANCE` is set, and
   that the user should run `plane-mcp init <name>` (first-time setup) or set `PLANE_API_KEY`
   directly (env/CI path).

`PLANE_WORKSPACE_SLUG`, `PLANE_BASE_URL`, `PORT` are unaffected — still read from `process.env`
exactly as today, since `plane-mcp init` prints them as plain env values (they are not secret).

### Multi-instance

Because the keychain entry is namespaced `plane-mcp/<name>` and the runtime selects it via
`PLANE_MCP_INSTANCE`, two `init` runs (`plane-mcp init breeze --workspace breeze-hq` and
`plane-mcp init juspay --workspace juspay-hq`) produce two keychain entries and two MCP server
blocks (`plane-breeze`, `plane-juspay`) that can both be registered with the same client
simultaneously — each subprocess launch of `plane-mcp` gets a distinct `PLANE_MCP_INSTANCE` in
its own `env` block, so there is no runtime collision even though both processes share the same
`plane-mcp` binary.

### Launchd relocation (Phase 15 fold-in)

The uncommitted Phase 15 output — `scripts/plane-mcp-serve.sh`, `scripts/store-secrets.sh`,
`scripts/install-launchd.sh`, `scripts/uninstall-launchd.sh`, `deploy/com.plane-mcp.server.plist`,
`plans/plane-mcp/15-local-service.md` — is not committed standalone. Instead:

- The four scripts and the plist move to `examples/macos-launchd/` (flat, no `scripts/`/`deploy/`
  split, since this is now a self-contained optional example rather than a first-class repo
  path).
- `scripts/store-secrets.sh` and `scripts/plane-mcp-serve.sh` are generalized: instead of
  hardcoding one user's workspace and `PORT=8787`, the wrapper reads `PLANE_API_KEY` /
  `PLANE_WORKSPACE_SLUG` either from env (if already exported) or by shelling out to the new
  `src/secrets.ts` read path via `plane-mcp`-adjacent tooling, and defaults to
  `https://api.plane.so` / port `3000` — matching this repo's public defaults, not any one
  deployment's private config. The example's README note documents overriding both via env vars
  before running the install script.
- `docs/plans/README.md`'s numbering stays intact: `15-local-service.md` is superseded content,
  not deleted history — Phase 16's own plan doc (`16-secure-setup.md`, this file) is the record
  of the fold-in; `15-local-service.md` is not rewritten in place (it already describes what was
  built, and Phase 16 changes where it lives, not what it does). No git operations to "undo"
  Phase 15's uncommitted work are specified here — the orchestrator relocates the working-tree
  files as part of implementing this phase's tasks.
- `.npmignore` gains an `examples/` line (its existing `scripts/` and `deploy/` lines become
  redundant once the directories are empty/removed at their old paths, but are left in place
  rather than pulled, since a stray future `scripts/`-or-`deploy/`-named file should still be
  excluded by default).
- README's root-level "## Run as a persistent local service (macOS launchd)" section is
  replaced: the primary "Setup" path becomes `plane-mcp init <name>`, and a short "Optional:
  persistent local service (macOS)" paragraph points at `examples/macos-launchd/README.md` (or
  equivalent) for the launchd add-on, explicitly marked macOS-only and optional.

### Tests

- `src/secrets.test.ts` — inject a mock `CommandRunner`; assert `writeSecret`/`readSecret`/
  `deleteSecret` build the exact argv per platform branch (test by forcing `process.platform`
  via the existing project pattern for platform-conditional code, or by exposing the
  per-platform command-builder functions individually for direct unit testing), assert secret
  values never appear in anything passed to `log()`, assert the file-fallback path writes `0600`
  and round-trips a value without shelling out at all.
- `src/config.test.ts` (extends existing coverage) — three cases: `PLANE_API_KEY` env set (used
  directly, no keychain call); `PLANE_MCP_INSTANCE` set and `PLANE_API_KEY` unset (keychain read
  invoked, mocked `ok: true` → resolves; mocked `ok: false` → throws the instance-specific
  error); neither set → throws the `plane-mcp init` guidance error.
- `src/cli/init.test.ts` — asserts the printed config JSON block does not contain the API key
  string anywhere in stdout, asserts `--register` shells out with the expected argv (mocked
  runner, no real `claude` invocation), asserts a re-run with the same `<name>` overwrites
  rather than erroring (mocked `writeSecret` idempotency).
- No `as unknown as` / `@ts-expect-error` / `@ts-ignore` anywhere in new or touched test code —
  Phase 13's structural-typing pattern (inject via a typed `CommandRunner`/`FetchLike`-shaped
  parameter) is the required approach for every new mock.

## Tasks

- [x] `types/secrets.ts`: `SecretBackend`, `SecretResult`, `SecretReadResult`, `CommandRunner`,
      `CommandResult`; export from `types/index.ts`
- [x] `src/secrets.ts`: platform dispatch, macOS `security` backend, Linux `secret-tool` backend
      (with `Bun.which` presence check), Windows + generic file fallback backend, default
      `Bun.spawn`-backed `CommandRunner`
- [x] `src/secrets.test.ts`: mocked-runner coverage for all backends + fallback + redaction
- [x] `src/config.ts`: make `loadAuthContext` async, add the `PLANE_MCP_INSTANCE` keychain
      branch and the three-way error messaging; update its call site (`src/stdio.ts`) to `await` it
      (note: `src/index.ts` HTTP entry unchanged per RFC scope — deferred)
- [x] `src/config.test.ts`: extend with the three resolution-order cases
- [x] `src/stdio.ts`: embedded dispatcher (check for `init` subcommand vs default stdio path);
      `package.json` `bin.plane-mcp` unchanged (points at `src/stdio.ts`, now does dispatch)
- [x] `src/init.ts` (CLI entry): arg parsing, hidden-input prompt, `setSecret` call, config-block
      printing (no key embedded), `--register` shell-out to `claude mcp add`
- [x] `src/init.test.ts`: printed-config no-key assertion, `--register` argv assertion,
      overwrite-on-rerun assertion
- [x] Relocate `scripts/*.sh` + `deploy/com.plane-mcp.server.plist` → `examples/macos-launchd/`,
      generalize secret/workspace/port sourcing (now env-driven, defaults api.plane.so/3000), add
      short `examples/macos-launchd/README.md` (note: `store-secrets.sh` superseded by `plane-mcp init`,
      not relocated)
- [x] `.npmignore`: add `examples/`
- [x] `README.md`: rewrite "Setup" section around `plane-mcp init`, replace root-level launchd section
      with pointer to `examples/macos-launchd/`, document Windows file-fallback caveat, document
      multi-instance usage, keep auth resolution order table
- [x] `CLAUDE.md`: add auth-resolution order, CLI init command, and secrets-module routing; update
      Authentication section to document `PLANE_MCP_INSTANCE` keychain path
- [x] `docs/plans/TRACK.md`: Phase 16 row marked [x] done, decision #12 logged (cross-platform keychain
      multi-instance auth, Phase 15 fold-in), note on `store-secrets.sh` superseded
- [x] `bunx tsc --noEmit` clean
- [x] `./node_modules/.bin/oxlint` (type-aware) clean, zero new suppressions
- [x] `bun test` — all new and existing tests green
- [x] `bunx prettier --check .` clean
- [x] No hardcoded secrets in `examples/macos-launchd/`

## Definition of done

- [x] `plane-mcp init <name> --workspace <slug>` stores the key via `src/secrets.ts` and prints
      a config block for `plane-<name>` with no API key present anywhere in stdout
- [x] A second `plane-mcp init <other-name> --workspace <other-slug>` run coexists with the
      first — two independent keychain entries, two independent printed configs, no collision
- [x] At runtime, `loadAuthContext` resolves the key from the keychain by `PLANE_MCP_INSTANCE`
      when `PLANE_API_KEY` is unset, and from `PLANE_API_KEY` directly when it is set
- [x] No API key is ever passed to `log()`, printed by any code path other than the deliberate
      "you are about to paste a hidden-input value" prompt itself, or written into any MCP
      client config text
- [x] Phase 15's launchd artifacts live under `examples/macos-launchd/` only; `scripts/` and
      `deploy/` left for user to remove (agents cannot `rm`); `.npmignore` excludes `examples/`;
      `store-secrets.sh` superseded by `plane-mcp init` and not relocated
- [x] `bunx tsc --noEmit`, `./node_modules/.bin/oxlint` (type-aware), `bun test`, `bunx prettier
--check .` all green
- [x] Zero `as unknown as`, `@ts-expect-error`, `@ts-ignore` in new or touched code (Phase 13
      rule holds)
- [x] `README.md` "Setup" section documents `plane-mcp init` as the primary local-setup path and
      links to `examples/macos-launchd/` as the optional persistence add-on; Windows caveat
      documented; multi-instance example shown
- [x] `CLAUDE.md` updated with the new auth-resolution order, CLI init routing, and secrets-module
      locations
- [x] `plans/plane-mcp/00-rfc.md` amended (Non-goals + AuthContext design + Alternatives, dated
      2026-08-07) — done as part of this same phase's plan authoring
- [x] `docs/plans/TRACK.md` updated with Phase 16 row marked done and decisions-log entry #12

## Open questions

- **Windows store read strategy**: ship the file-fallback-only approach documented above, or
  invest in a PowerShell/DPAPI read path (`Get-StoredCredential` via the `CredentialManager`
  PowerShell module, or a `CredRead` P/Invoke shim) to reach native Credential Manager parity
  with macOS/Linux? The file fallback is simpler and dependency-free but stores the secret in a
  file rather than the OS-native store; the PowerShell path is more "real" but adds a
  Windows-only code path with its own testing burden. Deferred to a follow-up decision before
  Windows is called first-class-supported in README (currently it will be documented as
  "file-fallback, see caveat").
- **`remove`/`list` subcommands**: ship in this phase or a fast-follow? Deferred to fast-follow
  per Out of scope — `init --help` should still mention them as planned so users are not
  surprised there's no built-in way to rotate or enumerate instances yet.
