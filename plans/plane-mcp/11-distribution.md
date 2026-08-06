# feat-distribution

Phase: 11 | Status: [x] done
Depends on: 10-hardening
Ref: `plans/plane-mcp/00-rfc.md` (Non-goals amendment + Alternatives "stdio-only transport — rejected"), `README.md`, `src/index.ts`, `src/server.ts`, `src/config.ts`, `src/logger.ts`

## Goal

Add a stdio MCP transport entry point (`src/stdio.ts`) alongside the existing
HTTP transport so the server is installable and launchable as a local MCP via
`bun link` (producing a `plane-mcp` command usable the way a `bunx`-style
command-launched MCP is configured in a client), without disturbing the
HTTP transport or any locked tool/architecture decision from Phases 00-10.

## In scope

- `src/stdio.ts` — new stdio transport entry point.
- `package.json` — `bin` map gains a second entry; new `start:stdio` script.
- README — new "Install as a local MCP (stdio)" section.
- A stdio smoke test (in-process preferred; documented manual fallback if
  the in-process approach proves impractical against the real SDK).
- `docs/plans/TRACK.md` — Phase 11 row + decision-log note (tracked as part
  of this phase's Definition of done; the actual edit already lives in this
  plan set's Task 3, cross-referenced here for completeness).

## Out of scope

- npm publish / registry distribution. `package.json` stays `private: true`.
  `bun link` operates on the local checkout only and needs no registry.
- Removing, deprecating, or otherwise touching the HTTP transport
  (`src/index.ts`). Both transports ship and are documented.
- OAuth or any auth mechanism beyond the existing env-var
  `PLANE_API_KEY`/`PLANE_WORKSPACE_SLUG`/`PLANE_BASE_URL` model. stdio reuses
  `loadAuthContext()` verbatim.
- SSE (legacy) transport — still out of scope per the RFC.
- Any change to tool registration, `PlaneClient`, or field normalization.
  This phase only adds a second way to boot the same `McpServer` instance
  produced by `createServer()`.
- A client-side process supervisor, auto-restart, or daemonization for the
  stdio entry — the MCP client (Claude Code, Claude Desktop, etc.) owns the
  subprocess lifecycle, per the standard stdio binding.

## Design

### Why stdio, now (context for implementers)

The RFC's "stdio-only transport — rejected" alternative rejected stdio as the
_sole_ transport for the whole server (see amendment in `00-rfc.md`). It did
not anticipate a later ask for a **second, additive** transport aimed at
single-user local installs launched by a command (`bunx`/`bun link`-style
invocation) rather than a long-lived HTTP process a client points a URL at.
Phase 11 adds stdio as that second transport. HTTP remains the transport for
the "one local server, multiple clients" use case the RFC locked in; stdio
is for "one client subprocess-launches its own server instance," which is
the shape most MCP client config UIs (`mcpServers` with a `command`) expect
out of the box.

### `src/stdio.ts` — exact wiring

```ts
#!/usr/bin/env bun

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server';
import { loadAuthContext } from './config';
import { log } from './logger';

const auth = loadAuthContext();
const server = createServer(auth);
const transport = new StdioServerTransport();

log('info', 'plane-mcp stdio server starting', { operation: 'server_init', transport: 'stdio' });

await server.connect(transport);
```

Notes, all verified against the installed `@modelcontextprotocol/server@2.0.0`
package (see `node_modules/@modelcontextprotocol/server/package.json`
`exports` map and `dist/stdio.d.mts`):

- Import specifier is the **subpath** `@modelcontextprotocol/server/stdio`,
  not the root package specifier. The root package's `exports` map declares
  `./stdio` as a distinct entry (`dist/stdio.mjs` / `dist/stdio.d.mts`);
  importing `StdioServerTransport` from the root specifier does not resolve.
- `createServer(auth: AuthContext): McpServer` (from `src/server.ts`, Phase 05) and `loadAuthContext(): AuthContext` (from `src/config.ts`, Phase 03)
  are reused unmodified — no new factory, no duplicated tool registration.
  This is the same guarantee HTTP and stdio both rely on: one
  `createServer()` producing an identically-tooled `McpServer` regardless of
  transport.
- `new StdioServerTransport()` takes no arguments in production use (reads
  the real process's `stdin`/writes `stdout`); the constructor signature
  `(_stdin?: Readable, _stdout?: Writable, options?)` also accepts injected
  streams, which the smoke test below relies on.
- `server.connect(transport: Transport): Promise<void>` starts the
  transport and binds it to the server; the process then stays alive
  reading from stdin until the client closes the pipe or the process is
  killed — no `Bun.serve`, no port, no `PORT` env var involvement.
- `PORT` is irrelevant to this entry point. It is not read, not validated,
  and not part of the stdio startup log line — do not carry it over from
  `src/index.ts`'s `loadPort()` call.
- Logging: `log()` (Phase 01, `src/logger.ts`) is already stderr-only
  (`process.stderr.write`), which is exactly what stdio transports require
  — stdout is reserved for JSON-RPC framing. No change to `logger.ts` is
  needed or in scope; this phase only depends on that existing invariant.
- Shebang `#!/usr/bin/env bun` (matches the existing shebang convention in
  `src/index.ts`) so the file is directly executable once `bin`-linked.

### `package.json` changes

```jsonc
{
  "bin": {
    "plane-mcp": "./src/stdio.ts",
    "plane-mcp-http": "./src/index.ts",
  },
  "scripts": {
    "start": "bun run src/index.ts",
    "start:stdio": "bun run src/stdio.ts",
    // ...existing scripts unchanged
  },
  "private": true, // unchanged — no npm publish this phase
}
```

- `plane-mcp` (the bare, unqualified command a client config's `command:`
  field will reference) now points at the **stdio** entry — this is the
  default "local MCP" experience the RFC amendment records as the reason
  for this phase.
- `plane-mcp-http` is a new, explicit bin name for the HTTP entry, for
  anyone who linked the package specifically to get the HTTP server as a
  global command (rare; `bun run start` remains the primary way to run
  HTTP inside the repo).
- `start:stdio` mirrors the existing `start` script's shape for
  discoverability inside the repo (`bun run start:stdio` boots stdio
  without needing `bun link` first — useful for the smoke test below).
- `private: true` is unchanged. `bun link` does not require publishing;
  it symlinks the local package into Bun's global bin directory so
  `plane-mcp` resolves to this checkout's `src/stdio.ts` on `PATH`. No
  registry interaction occurs.

### `bun link` flow (documented in README, exercised in Definition of done)

1. From the repo root: `bun link`. This registers the local package (by
   the `name` field, `plane-mcp`) in Bun's global link directory and makes
   both `bin` entries (`plane-mcp`, `plane-mcp-http`) resolve globally.
2. Any client that shells out to a `command` (not a URL) can now invoke
   `plane-mcp` directly — Bun resolves it to `bun run <repo>/src/stdio.ts`
   under the hood via the shebang + bin symlink.
3. Uninstall/cleanup: `bun unlink` from the repo root (or `bun unlink
plane-mcp` from anywhere) removes the global symlink. Document this
   alongside the install steps so the README isn't install-only.

### Client configuration (README content, both forms)

**Claude Code CLI (command form):**

```bash
claude mcp add plane \
  --env PLANE_API_KEY=<token> \
  --env PLANE_WORKSPACE_SLUG=<slug> \
  -- plane-mcp
```

**Generic `mcpServers` JSON config:**

```json
{
  "mcpServers": {
    "plane": {
      "command": "plane-mcp",
      "args": [],
      "env": {
        "PLANE_API_KEY": "...",
        "PLANE_WORKSPACE_SLUG": "...",
        "PLANE_BASE_URL": "https://api.plane.so"
      }
    }
  }
}
```

Both forms pass env vars **from the client into the subprocess** — the
client, not this repo, owns `.env`/secret storage for the stdio path. The
README must state explicitly: env is supplied by the launching client, and
`PLANE_API_KEY`/`PLANE_WORKSPACE_SLUG` are never logged (existing
`src/logger.ts` `REDACTED_KEYS` guarantee, unchanged by this phase).

### Testing approach

Preferred: an **in-process** smoke test, since `StdioServerTransport`'s
constructor accepts injected streams:

```ts
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../src/server';
import { loadAuthContext } from '../src/config'; // or a constructed AuthContext fixture
```

Construct `new StdioServerTransport(customReadable, customWritable)` with an
in-memory `Readable`/`Writable` pair, write a JSON-RPC `initialize` request
into the readable side (newline-delimited, matching the stdio framing the
transport's `_ondata`/`processReadBuffer` expects), `await
server.connect(transport)`, and assert the writable side receives a valid
`initialize` response naming `serverInfo.name === 'plane-mcp'`. No
subprocess, no `bun run` shell-out, no real stdin/stdout.

If the in-process approach proves impractical against the real SDK (e.g.
stream lifecycle or buffering quirks that make injected-stream framing
unreliable to assert on), fall back to: `bun run typecheck` passing for
`src/stdio.ts`, plus a **documented manual smoke test** for a human to run
and confirm:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-smoke","version":"0.0.0"}}}' \
  | bun run src/stdio.ts
```

Which of the two this phase lands on is an explicit open question below —
attempt in-process first; only fall back with a note in this file's Open
questions section (updated in place, not silently) if it doesn't hold up.

## Tasks

- [ ] Write `src/stdio.ts` per Design (shebang, imports, `createServer` +
      `loadAuthContext` + `StdioServerTransport` + `connect`, stderr-only
      startup log)
- [ ] Update `package.json`: `bin.plane-mcp` → `./src/stdio.ts`, add
      `bin["plane-mcp-http"]` → `./src/index.ts`, add `start:stdio` script,
      keep `start` and `private: true` unchanged
- [ ] Write the stdio smoke test (in-process preferred; manual fallback
      documented if not feasible) — file location follows the existing
      `*.test.ts` co-location convention (e.g. `src/stdio.test.ts`)
- [ ] Add README "Install as a local MCP (stdio)" section: `bun link` /
      `bun unlink`, Claude Code CLI command-form example, generic
      `mcpServers` JSON example, note on client-supplied env + no logging
      of secrets
- [ ] Confirm `README.md`'s existing HTTP "Connect an MCP Client" section
      is left intact and now sits alongside (not replaced by) the new
      stdio section — add a one-line pointer between the two so a reader
      picks the transport intentionally rather than stumbling on stdio
      first
- [ ] Update `docs/plans/TRACK.md`: add the Phase 11 row, append a
      decisions/log entry recording that stdio was added post-hardening
      for local install, HTTP retained as the multi-agent transport
- [ ] Update `CLAUDE.md` routing table / any phase-file cross-reference
      that enumerates "Phase 00-10" as the full set, if such a reference
      exists, so it reads "00-11"

## Definition of done

- [ ] `bun link` from the repo root, then invoking the linked `plane-mcp`
      command boots the server over stdio and answers a JSON-RPC
      `initialize` request (verified either by the in-process test or the
      documented manual smoke test — see Open questions)
- [ ] `plane-mcp-http` (or `bun run start`) still boots the HTTP transport
      exactly as before this phase — `/health` and `/mcp` both respond
      unchanged
- [ ] `bun run typecheck` — zero errors, including `src/stdio.ts`
- [ ] `bun run format:check` and `bun run lint` — zero errors
- [ ] `bun test` — all suites green, including the new stdio smoke test
- [ ] README contains the "Install as a local MCP (stdio)" section with
      both the Claude Code CLI form and the JSON `mcpServers` form
- [ ] `docs/plans/TRACK.md` updated: Phase 11 row present, decisions/log
      entry added, no stale "project complete at Phase 10" language left
      unqualified
- [ ] No change to `src/index.ts`, `src/server.ts`, `src/config.ts`
      tool-registration behavior, or any of the 31 locked tools

## Open questions

- **In-process vs. manual smoke test**: ✓ RESOLVED — implemented in-process.
  The in-process approach (injected `Readable`/`Writable` into
  `StdioServerTransport`) was implemented successfully in `src/stdio.test.ts`.
  The full JSON-RPC `initialize` handshake is exercised in-process with
  event-driven waiting (no fixed delays), so the manual-smoke-test fallback
  was not needed.
- **Future npm publish**: whether `private: true` is ever flipped so
  `plane-mcp` is installable via a real `bunx plane-mcp` without `bun link`
  first is explicitly deferred — not decided by this phase. `bun link`
  satisfies the immediate "local install of this checkout" need; a
  registry publish is a distinct future decision with its own versioning/
  release-process questions, out of scope here per the RFC amendment.
