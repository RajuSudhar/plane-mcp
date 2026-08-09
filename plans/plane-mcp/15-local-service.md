# feat-local-service

Phase: 15 | Status: [x] done
Depends on: 14-npm-publish
Ref: `scripts/`, `deploy/`, `README.md`, `docs/plans/TRACK.md`

## Goal

Provide a persistent macOS launchd service (LaunchAgent) that runs the HTTP server with
the API key and workspace slug read securely from the login Keychain. This enables users
to start plane-mcp once at login, then share the HTTP endpoint with MCP clients
(Claude Desktop, VS Code, etc.) without repeatedly entering credentials.

## In scope

- `scripts/plane-mcp-serve.sh`: runtime wrapper that reads secrets from the login
  Keychain via `security find-generic-password` and runs `bun run start`.
- `scripts/store-secrets.sh`: one-time setup script that prompts interactively for
  PLANE_API_KEY and PLANE_WORKSPACE_SLUG and stores them in the login Keychain
  with `-T /usr/bin/security` pre-authorization for non-interactive reads.
- `deploy/com.plane-mcp.server.plist`: LaunchAgent plist template (not installed
  directly; installer fills `__SERVE_SH__` and `__HOME__` placeholders).
- `scripts/install-launchd.sh`: sed-based installer that fills the plist template
  with real paths, installs to `~/Library/LaunchAgents/`, and uses `launchctl`
  to bootstrap and kickstart the agent at login.
- `scripts/uninstall-launchd.sh`: removes the LaunchAgent and plist file.
- `README.md`: add section "## Run as a persistent local service (macOS launchd)"
  documenting the flow, Keychain-in-launchd caveats, log locations, and client config.
- `plans/plane-mcp/15-local-service.md`: this phase documentation.
- `docs/plans/TRACK.md`: add Phase 15 row, update decisions-log.
- `.npmignore`: confirm `scripts/` and `deploy/` are already excluded from npm tarball.

## Out of scope

- Linux / systemd equivalents (macOS launchd only).
- LaunchDaemon (pre-login boot-time startup; login-only agent is sufficient).
- Bundling secrets into the plist or `.env` file (Keychain is the only secret store).
- Automatic secret rotation or expiry management.
- Client-side configuration management (users config their MCP clients separately).

## Design

### Keychain read via security

The `security` command-line tool (built-in on macOS) queries the login Keychain
without exposing secrets to the shell or environment. Two entries are stored:

- Service: `plane-mcp/PLANE_API_KEY` → Account: `$USER` → Password: the token
- Service: `plane-mcp/PLANE_WORKSPACE_SLUG` → Account: `$USER` → Password: the slug

The `-T /usr/bin/security` flag in `security add-generic-password` pre-authorizes
non-interactive reads by the security tool itself, so the LaunchAgent-driven read
does not trigger a Keychain prompt every time the server restarts (though the first
read may still prompt once).

### Portable paths

All paths are derived at runtime:

- `BUN` defaults to `$HOME/.bun/bin/bun` (Bun's default install location).
- `APP_DIR` is derived from the script location (`$(dirname "$0")/..`), so the entire
  repo can be moved or symlinked without updating hardcoded paths.
- `HOME` is passed explicitly to the plist so the LaunchAgent knows the user's home,
  avoiding issues with launchd's limited environment.
- Log paths are `~/Library/Logs/plane-mcp.out.log` and `plane-mcp.err.log`.

### launchctl bootstrap/kickstart

The installer uses:

1. `launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true` — gracefully
   unload any previous version (ignores "not loaded" errors).
2. `launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"` — load the new plist.
3. `launchctl kickstart -k "gui/$(id -u)/$LABEL"` — force start immediately
   (rather than waiting for next login).

The `gui/$(id -u)` syntax targets the user-scoped domain (login domain).

### Login agent, not boot daemon

LaunchAgents are user-scoped and load at login, not at pre-login boot time.
This aligns with the interactive, per-user secret-storage model (Keychain
is per-user, login-locked). If pre-login boot startup is needed, use
LaunchDaemon (out of scope).

### README section structure

Document the flow in 5 steps:

1. `sh scripts/store-secrets.sh` — interactively store secrets.
2. `sh scripts/plane-mcp-serve.sh` (once by hand to verify and accept Keychain prompt).
3. `sh scripts/install-launchd.sh` — load the LaunchAgent at login.
4. `curl http://127.0.0.1:3000/health` — verify the server is running.
5. `claude mcp add --transport http --scope user plane http://127.0.0.1:3000/mcp`
   — register the plane-mcp server with the client.

Include caveats:

- Keychain first-read prompt (click "Always Allow").
- LaunchAgent loads at login, not immediately after install (or immediate via kickstart).
- Log files in `~/Library/Logs/plane-mcp.*.log` for debugging.
- `sh scripts/uninstall-launchd.sh` to remove the agent.

## Tasks

- [x] Create `scripts/plane-mcp-serve.sh` (Keychain read + exec bun run start)
- [x] Create `scripts/store-secrets.sh` (interactive secret prompt, add-generic-password -T)
- [x] Create `scripts/install-launchd.sh` (sed template fill, launchctl bootstrap/kickstart)
- [x] Create `scripts/uninstall-launchd.sh` (bootout + rm)
- [x] Create `deploy/com.plane-mcp.server.plist` (plist template with placeholders)
- [x] Add "## Run as a persistent local service (macOS launchd)" section to README.md
- [x] Create `plans/plane-mcp/15-local-service.md` (this file)
- [x] Run `sh -n scripts/plane-mcp-serve.sh` — confirm syntax
- [x] Run `sh -n scripts/store-secrets.sh` — confirm syntax
- [x] Run `sh -n scripts/install-launchd.sh` — confirm syntax
- [x] Run `sh -n scripts/uninstall-launchd.sh` — confirm syntax
- [x] Run `plutil -lint deploy/com.plane-mcp.server.plist` — confirm plist validity
- [x] Run `chmod +x scripts/*.sh` — make scripts executable
- [x] Verify no hardcoded secrets in scripts/ or deploy/
- [x] Verify `.npmignore` already excludes `scripts/` and `deploy/`
- [x] Run `bunx tsc --noEmit` — confirm zero errors
- [x] Run `./node_modules/.bin/oxlint` — confirm zero errors
- [x] Run `bun test` — confirm all tests pass
- [x] Run `bunx prettier --check .` — confirm formatting clean
- [x] Update `docs/plans/TRACK.md`: add Phase 15 row, update decisions-log

## Definition of done

- [x] `scripts/plane-mcp-serve.sh` exists, is executable, reads secrets from Keychain
- [x] `scripts/store-secrets.sh` exists, is executable, prompts interactively, uses `-T` flag
- [x] `scripts/install-launchd.sh` exists, is executable, uses sed to fill placeholders,
      calls launchctl bootstrap/kickstart
- [x] `scripts/uninstall-launchd.sh` exists, is executable, calls launchctl bootout
- [x] `deploy/com.plane-mcp.server.plist` is a valid plist with `__SERVE_SH__` and `__HOME__`
      placeholders (not filled; installer fills them)
- [x] `README.md` contains "## Run as a persistent local service (macOS launchd)" section
      with 5-step flow, Keychain/login caveats, and log path documentation
- [x] `README.md` section is Prettier-clean (printWidth 120)
- [x] All 4 shell scripts pass syntax check (`sh -n`)
- [x] Plist is valid (`plutil -lint` → OK)
- [x] All scripts are executable (`chmod +x`)
- [x] No hardcoded secrets (API keys, workspace slugs) appear in scripts or plist
- [x] `.npmignore` excludes `scripts/` and `deploy/` (preventing them from npm tarball)
- [x] `bunx tsc --noEmit` passes (exit 0)
- [x] `./node_modules/.bin/oxlint` passes (exit 0)
- [x] `bun test` passes (all 117 assertions)
- [x] `bunx prettier --check .` reports zero formatting changes needed
- [x] No `.js` files emitted or committed
- [x] `docs/plans/TRACK.md` updated with Phase 15 row and decisions-log entry

## Open questions

None — design is straightforward and constrained to macOS launchd mechanics.
