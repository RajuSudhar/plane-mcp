# plane-mcp

TypeScript MCP server for Plane, the open-source Jira-like ticketing and project management platform. Built on Bun 1.3.14
and TypeScript 7, this server provides 31 core ticket-workflow tools via a stateless streamable-HTTP transport with
environment-variable authentication.

## Beta Release

This is a **pre-1.0 beta release** published on the npm `beta` dist-tag (not `latest`). Install with `bunx plane-mcp@beta` or `bun add -g plane-mcp@beta`. Requires Bun 1.3.14 or later. This release is under active development and has not yet reached stable 1.0 maturity. Feedback and issue reports are welcome at https://github.com/RajuSudhar/plane-mcp/issues.

## Install

```bash
bun install
```

This project uses Bun exclusively — no npm, pnpm, or yarn. The `bun.lock` file is committed to the repository.

## Install from npm (Bun)

To use `plane-mcp` from npm without cloning the repository, install and run it directly with Bun:

```bash
bunx plane-mcp@beta
```

This runs the stdio MCP server. Requires Bun 1.3.14+ on your machine (plane-mcp is a Bun-native package).

Alternatively, install globally and invoke as a command:

```bash
bun add -g plane-mcp@beta
plane-mcp
```

**Note:** This beta release is published on the `beta` dist-tag, not `latest`. Always use `@beta` when installing until version 1.0 is released.

## Setup (recommended)

The recommended way to set up `plane-mcp` is via `plane-mcp init`, which securely stores your API key in the OS keychain
and prints a ready-to-use MCP client configuration. This setup supports multiple independent workspaces on the same
machine with zero manual config file editing.

### Step 1: Store your API key

Run the init command once per Plane workspace or deployment:

```bash
plane-mcp init <name> --workspace <slug> [--base-url <url>] [--register]
```

Example:

```bash
plane-mcp init my-workspace --workspace my-workspace-slug --base-url https://api.plane.so
```

Where:

- `<name>`: A local label for this instance (e.g., `my-workspace`, `client-a`). Used as the keychain key and instance
  identifier; must be unique per machine if you're setting up multiple workspaces.
- `<slug>`: Your Plane workspace slug (e.g., `my-workspace-slug`).
- `--base-url` (optional): Your Plane instance URL; defaults to `https://api.plane.so`. Must use `https`.
- `--register` (optional): Automatically register the server with `claude mcp add` (requires the `claude` CLI).
- `-y` (optional): Skip the config-scaffold confirmation prompt and use defaults (`~/.config/plane-mcp/config.json`, 25,000 tokens/tool).

The command will:

1. Prompt you (hidden input) for your Plane API key (Personal or Workspace Access Token).
2. Store the key securely in your OS keychain, keyed by instance `<name>`.
3. Print a JSON config block for your MCP client.
4. Scaffold a starter `plane-mcp.config.json` (unless one already exists at the target path) and add `PLANE_MCP_CONFIG` to the printed config.

**Security note on --key flag:** The optional `--key` flag allows passing the API key as a command-line argument, which is visible in the process list (via `ps`). This flag is intended for scripted/CI use only. For interactive sessions, the default hidden-input prompt is the secure choice.

### Step 2: Add to your MCP client

Copy the printed JSON config and add it to your MCP client's configuration file (e.g., Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "plane-my-workspace": {
      "command": "plane-mcp",
      "env": {
        "PLANE_MCP_INSTANCE": "my-workspace",
        "PLANE_WORKSPACE_SLUG": "my-workspace-slug",
        "PLANE_BASE_URL": "https://api.plane.so"
      }
    }
  }
}
```

Or, if you passed `--register` to `init`, the server is already registered and you can skip this step.

### Multiple workspaces

To set up a second workspace on the same machine, repeat `plane-mcp init` with a different `<name>`:

```bash
plane-mcp init client-b --workspace client-b-slug --base-url https://api.plane.so
```

This creates a second keychain entry and a second MCP server config (`plane-client-b`), both accessible to your MCP
client simultaneously with no conflict.

### Auth resolution order

At runtime, the server resolves the API key in this order:

1. `PLANE_API_KEY` environment variable (if set; used for CI/dev fallback, skips keychain).
2. `PLANE_MCP_INSTANCE` keychain lookup (if set; recommended for local use).
3. Error: neither env var nor instance provided.

### Windows note

On Windows, the OS credential store is not directly accessible via the CLI. `plane-mcp init` uses a file-based fallback
(`~/.config/plane-mcp/credentials.json`, mode `0600`) instead. **This is less secure than the native OS keychain on
macOS/Linux** — keep your local machine secure and consider using a headless CI/deployment service or the `PLANE_API_KEY`
env-var path for production servers.

## Run

Start the server:

```bash
bun run start
```

For local development with auto-reload:

```bash
bun run dev
```

The server binds to `127.0.0.1` on the configured port (default 3000). It exposes:

- `GET /health` → `{"status":"ok"}`
- `POST /mcp` → MCP endpoint (stateless streamable HTTP transport)

## Connect an MCP Client (HTTP mode)

If you're running the HTTP server (`bun run start` or `plane-mcp-http` bin), point any streamable-HTTP MCP client at
`http://127.0.0.1:3000/mcp`. Example client configuration (e.g., for Claude Desktop or VS Code):

```json
{
  "mcpServers": {
    "plane": {
      "url": "http://127.0.0.1:3000/mcp",
      "type": "http"
    }
  }
}
```

The client sends a JSON-RPC `initialize` request on first connection:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "example-client",
      "version": "1.0.0"
    }
  }
}
```

## Configure via environment variables (advanced)

For CI/dev/scripting scenarios where interactive prompts are not practical, you can set credentials directly as
environment variables:

Set the following environment variables in a `.env` file (see `.env.example` for a template):

| Variable                      | Required | Default                      | Description                                       |
| ----------------------------- | -------- | ---------------------------- | ------------------------------------------------- |
| `PLANE_API_KEY`               | Yes      | —                            | Personal or Workspace Access Token (never logged) |
| `PLANE_WORKSPACE_SLUG`        | Yes      | —                            | Workspace identifier (e.g., `my-workspace`)       |
| `PLANE_BASE_URL`              | No       | `https://api.plane.so`       | Plane API base URL (must be `https`)              |
| `PORT`                        | No       | `3000`                       | Server port (valid range: 1-65535)                |
| `PLANE_MCP_CONFIG`            | No       | (discovery order, see above) | Absolute path to a behavior config file           |
| `PLANE_MCP_MAX_OUTPUT_TOKENS` | No       | `25000`                      | Overrides the default per-tool output-token limit |

To generate `PLANE_API_KEY`, go to Plane → Profile Settings → Personal Access Tokens, or Workspace Settings → Access
Tokens for a bot token. None of these values are logged by the server.

### MCP Client Configuration (bunx)

For Claude Desktop, VS Code with MCP extension, or other MCP clients that support command-based transport, configure as:

```json
{
  "mcpServers": {
    "plane": {
      "command": "bunx",
      "args": ["plane-mcp"],
      "env": {
        "PLANE_API_KEY": "your-api-token",
        "PLANE_WORKSPACE_SLUG": "your-workspace"
      }
    }
  }
}
```

The HTTP mode (`plane-mcp-http`) is also available if you need one server to serve multiple clients. This is a Bun-native
package; Node-only users would need to build it separately (out of scope).

## Install as a local MCP (stdio) — Alternative

As an alternative to the HTTP transport or the recommended `plane-mcp init` setup, you can install `plane-mcp` as a
local command-launched MCP server using Bun's `bun link` feature. This allows MCP clients (Claude Code, Claude Desktop,
etc.) to subprocess-launch their own dedicated server instance via stdio instead of connecting to a long-running HTTP
server.

### Setup

From the repo root, link the package globally:

```bash
bun link
```

This registers the `plane-mcp` command in Bun's global bin directory. To uninstall later:

```bash
bun unlink plane-mcp
```

### Configuration

Environment variables are supplied by the MCP client — not by `.env` — and are never logged by the server. Secrets are
protected by the client's own config storage (e.g., `~/.config/codeium/mcp.json` or Claude Desktop's settings).

**Claude Code CLI (command form):**

```bash
claude mcp add plane \
  --env PLANE_API_KEY=<your-token> \
  --env PLANE_WORKSPACE_SLUG=<your-workspace> \
  --env PLANE_BASE_URL=https://plane.breezehq.dev \
  -- plane-mcp
```

**Generic `mcpServers` JSON config** (e.g., Claude Desktop, VS Code with MCP extension):

```json
{
  "mcpServers": {
    "plane": {
      "command": "plane-mcp",
      "args": [],
      "env": {
        "PLANE_API_KEY": "your-api-token",
        "PLANE_WORKSPACE_SLUG": "your-workspace",
        "PLANE_BASE_URL": "https://plane.breezehq.dev"
      }
    }
  }
}
```

The stdio server reads these env vars at startup and exposes the same 31 tools as the HTTP transport. No `PORT` env var
is needed for stdio — the MCP client manages the process lifecycle.

---

**Note:** This "local MCP" install via stdio is an alternative approach for single-user, local setups. The recommended
approach is to use `plane-mcp init` (above), which manages your secrets securely. The HTTP transport (`bun run start` or
`plane-mcp-http` bin entry) is still available if you need one server to serve multiple clients or to run long-lived in
production.

## Optional: Run as a persistent macOS launchd service

If you want the plane-mcp HTTP server to persist in the background on macOS after login, you can use launchd. This is
**entirely optional** — most users should use the `plane-mcp init` setup above.

For a persistent macOS service, see `examples/macos-launchd/README.md`. This example demonstrates how to configure a
LaunchAgent to keep the server running in the background, with logs in `~/Library/Logs/plane-mcp.*.log`.

**Prerequisite:** You must first run `plane-mcp init <name>` to store your API key in the keychain.

## Configure per-tool output-token limits

By default, every tool's response is capped at 25,000 estimated tokens. A response over the limit is never truncated — it is withheld entirely, and the tool returns an error explaining how to narrow the request (e.g. via `fields`, `per_page`, or `module_id`/`cycle_id` filtering).

This limit is controlled by an optional JSON config file, resolved in this order:

1. `PLANE_MCP_CONFIG` env var (must be an absolute path to the file)
2. `./plane-mcp.config.json` (current working directory)
3. `~/.config/plane-mcp/config.json` (honors `XDG_CONFIG_HOME` / `PLANE_MCP_CONFIG_DIR`, same directory `plane-mcp init` uses for credentials)
4. None found — built-in default (25,000 tokens per tool), zero config required

Example `plane-mcp.config.example.json` (copy to `./plane-mcp.config.json` or `~/.config/plane-mcp/config.json`):

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

The `$schema` field enables editor validation/autocomplete and is ignored at runtime. Unknown or misspelled keys anywhere in the file are rejected at startup with a precise error, rather than silently ignored.

`PLANE_MCP_MAX_OUTPUT_TOKENS` (an integer) overrides `defaults.maxOutputTokens` for a quick one-off change without editing the file — useful for CI or a single scripted run.

`plane-mcp init` scaffolds a starter config file for you (see Setup, above) and records its location as `PLANE_MCP_CONFIG` in the printed MCP client config.

## Tool Inventory

The server exposes 31 tools across 10 resource domains:

### User

| Tool     | Description                             |
| -------- | --------------------------------------- |
| `get_me` | Return the authenticated user's profile |

### Projects

| Tool               | Description                       |
| ------------------ | --------------------------------- |
| `list_projects`    | List projects in the workspace    |
| `retrieve_project` | Retrieve a single project by UUID |

### Work Items

| Tool                               | Description                                                      |
| ---------------------------------- | ---------------------------------------------------------------- |
| `list_work_items`                  | List work items in a project with filtering                      |
| `retrieve_work_item`               | Retrieve a single work item by UUID                              |
| `retrieve_work_item_by_identifier` | Retrieve a work item by human-readable identifier (e.g., PRJ-42) |
| `create_work_item`                 | Create a new work item in a project                              |
| `update_work_item`                 | Update an existing work item                                     |
| `delete_work_item`                 | Delete a work item                                               |
| `search_work_items`                | Search for work items in a project by query string               |

### Comments

| Tool                       | Description                       |
| -------------------------- | --------------------------------- |
| `list_work_item_comments`  | List comments for a work item     |
| `create_work_item_comment` | Create a comment on a work item   |
| `update_work_item_comment` | Update a comment on a work item   |
| `delete_work_item_comment` | Delete a comment from a work item |

### Relations

| Tool                        | Description                          |
| --------------------------- | ------------------------------------ |
| `list_work_item_relations`  | List relations for a work item       |
| `create_work_item_relation` | Create a relation between work items |
| `remove_work_item_relation` | Remove a relation between work items |

### States

| Tool           | Description                      |
| -------------- | -------------------------------- |
| `list_states`  | List all states for a project    |
| `create_state` | Create a new state for a project |

### Labels

| Tool           | Description                      |
| -------------- | -------------------------------- |
| `list_labels`  | List all labels for a project    |
| `create_label` | Create a new label for a project |

### Members

| Tool                    | Description                      |
| ----------------------- | -------------------------------- |
| `get_project_members`   | Get all members of a project     |
| `get_workspace_members` | Get all members of the workspace |

### Cycles

| Tool                          | Description                      |
| ----------------------------- | -------------------------------- |
| `list_cycles`                 | List all cycles for a project    |
| `create_cycle`                | Create a new cycle for a project |
| `add_work_items_to_cycle`     | Add work items to a cycle        |
| `remove_work_item_from_cycle` | Remove a work item from a cycle  |

### Modules

| Tool                           | Description                       |
| ------------------------------ | --------------------------------- |
| `list_modules`                 | List all modules for a project    |
| `create_module`                | Create a new module for a project |
| `add_work_items_to_module`     | Add work items to a module        |
| `remove_work_item_from_module` | Remove a work item from a module  |

## Development

### Commands

| Command                | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `bun run dev`          | Start dev server with auto-reload (`--watch`)                  |
| `bun run start`        | Start the server                                               |
| `bun run typecheck`    | Type-check only (`tsc --noEmit`)                               |
| `bun test`             | Run tests                                                      |
| `bun run format`       | Format code and docs with Prettier                             |
| `bun run format:check` | Check formatting with Prettier                                 |
| `bun run lint`         | Lint TypeScript files with type-aware oxlint                   |
| `bun run lint:fix`     | Fix linting issues with oxlint                                 |
| `bun run check`        | Run formatting and linting checks                              |
| `plane-mcp help`       | Print CLI usage, config discovery order, and env-var reference |

### TypeScript Configuration

This project uses TypeScript 7 with `noEmit: true` in `tsconfig.json`. Bun runs TypeScript natively, so no JavaScript
files are emitted or committed. Type-checking is performed via `bun run typecheck` which runs `tsc --noEmit`.

### Linting

Linting is performed via `bun run lint`, which uses oxlint with type-aware linting enabled (via the oxlint-tsgolint
integration). Type-aware linting catches promise-safety issues: floating promises, misused promises, stray awaits, and
async functions that don't actually await.

### Architecture

See `docs/ARCHITECTURE.md` for the system design, layering, request lifecycle, and field-name normalization details.
