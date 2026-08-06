# plane-mcp

TypeScript MCP server for Plane, the open-source Jira-like ticketing and project management platform. Built on Bun 1.3.14
and TypeScript 7, this server provides 31 core ticket-workflow tools via a stateless streamable-HTTP transport with
environment-variable authentication.

## Install

```bash
bun install
```

This project uses Bun exclusively — no npm, pnpm, or yarn. The `bun.lock` file is committed to the repository.

## Configure

Set the following environment variables in a `.env` file (see `.env.example` for a template):

| Variable               | Required | Default                | Description                                       |
| ---------------------- | -------- | ---------------------- | ------------------------------------------------- |
| `PLANE_API_KEY`        | Yes      | —                      | Personal or Workspace Access Token (never logged) |
| `PLANE_WORKSPACE_SLUG` | Yes      | —                      | Workspace identifier (e.g., `my-workspace`)       |
| `PLANE_BASE_URL`       | No       | `https://api.plane.so` | Plane API base URL (must be `https`)              |
| `PORT`                 | No       | `3000`                 | Server port (valid range: 1-65535)                |

To generate `PLANE_API_KEY`, go to Plane → Profile Settings → Personal Access Tokens, or Workspace Settings → Access
Tokens for a bot token. None of these values are logged by the server.

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

## Connect an MCP Client

Point any streamable-HTTP MCP client at `http://127.0.0.1:3000/mcp`. Example client configuration (e.g., for Claude
Desktop or VS Code):

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

## Two ways to connect

Choose your transport: run the HTTP server and point a client at its URL (above), or install the stdio command for a client that launches it directly (below).

## Install as a local MCP (stdio)

As an alternative to the HTTP transport, you can install `plane-mcp` as a local command-launched MCP server using Bun's `bun link`
feature. This allows MCP clients (Claude Code, Claude Desktop, etc.) to subprocess-launch their own dedicated server instance via
stdio instead of connecting to a long-running HTTP server.

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

Environment variables are supplied by the MCP client — not by `.env` — and are never logged by the server. Secrets are protected by
the client's own config storage (e.g., `~/.config/codeium/mcp.json` or Claude Desktop's settings).

**Claude Code CLI (command form):**

```bash
claude mcp add plane \
  --env PLANE_API_KEY=<your-token> \
  --env PLANE_WORKSPACE_SLUG=<your-workspace> \
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
        "PLANE_BASE_URL": "https://api.plane.so"
      }
    }
  }
}
```

The stdio server reads these env vars at startup and exposes the same 31 tools as the HTTP transport. No `PORT` env var is needed for
stdio — the MCP client manages the process lifecycle.

---

**Note:** This "local MCP" install via stdio is the recommended approach for single-user, local setups. The HTTP transport (`bun run
start` or `plane-mcp-http` bin entry) is still available if you need one server to serve multiple clients or to run long-lived in
production.

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

| Command                | Description                                   |
| ---------------------- | --------------------------------------------- |
| `bun run dev`          | Start dev server with auto-reload (`--watch`) |
| `bun run start`        | Start the server                              |
| `bun run typecheck`    | Type-check only (`tsc --noEmit`)              |
| `bun test`             | Run tests                                     |
| `bun run format`       | Format code and docs with Prettier            |
| `bun run format:check` | Check formatting with Prettier                |
| `bun run lint`         | Lint TypeScript files with type-aware oxlint  |
| `bun run lint:fix`     | Fix linting issues with oxlint                |
| `bun run check`        | Run formatting and linting checks             |

### TypeScript Configuration

This project uses TypeScript 7 with `noEmit: true` in `tsconfig.json`. Bun runs TypeScript natively, so no JavaScript
files are emitted or committed. Type-checking is performed via `bun run typecheck` which runs `tsc --noEmit`.

### Linting

Linting is performed via `bun run lint`, which uses oxlint with type-aware linting enabled (via the oxlint-tsgolint
integration). Type-aware linting catches promise-safety issues: floating promises, misused promises, stray awaits, and
async functions that don't actually await.

### Architecture

See `docs/ARCHITECTURE.md` for the system design, layering, request lifecycle, and field-name normalization details.
