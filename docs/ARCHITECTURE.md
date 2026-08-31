# ARCHITECTURE.md

## Overview

`plane-mcp` is a stateless MCP server for Plane (open-source Jira-like ticket tool) supporting dual transports: stdio
(subprocess-launched by MCP clients) and streamable-HTTP (long-running server on `127.0.0.1`). Built on Bun 1.3.14 and
TypeScript 7, authenticated via environment variables (`PLANE_API_KEY` or `PLANE_MCP_INSTANCE` keychain resolution +
`PLANE_WORKSPACE_SLUG`), with optional per-tool output-token limits via a config file (`plane-mcp.config.json`). The
server exposes 31 core ticket-workflow tools for creating, updating, searching, and managing work items, projects,
cycles, modules, comments, and relations.

## System diagram

```mermaid
graph TB
    Client[MCP Client] -->|POST /mcp| Bun[Bun.serve 127.0.0.1]
    Bun --> Hono[Hono App]
    Hono --> Health[/health endpoint]
    Hono --> MCP[/mcp endpoint]
    MCP --> Handler[createMcpHandler stateless]
    Handler --> Server[McpServer fresh per request]
    Server --> Tools[Registered Tools]
    Tools --> Wrapper[toolHandler wrapper]
    Wrapper --> PlaneClient[PlaneClient]
    PlaneClient --> PlaneAPI[Plane REST API]
    Auth[AuthContext env vars] -.-> PlaneClient
    Types[types/ @types alias] -.-> Tools
    Types -.-> PlaneClient
    Types -.-> Server
```

## Layering table

| Layer                        | Responsibility                                                                                                                                                                    | Key files                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Transport                    | Dual: stdio (`src/stdio.ts`, JSON-RPC over stdin/stdout) and HTTP (`src/index.ts`, Bun.serve on 127.0.0.1 with Hono /health and /mcp endpoints)                                   | `src/stdio.ts`, `src/index.ts`, `src/init.ts` (CLI dispatcher)                                                |
| MCP server/tool registration | Creates fresh McpServer per request (stateless), registers 31 tools with zod schemas, reject-and-guide token-limit enforcement per-tool                                           | `src/server.ts`, `src/tools/register.ts`, `src/tools/token-count.ts`                                          |
| Tools                        | Pure functions `(client, args) => ToolResult`; no process.env access, no transport coupling                                                                                       | `src/tools/*.ts` (users, projects, work-items, comments, relations, states, labels, members, cycles, modules) |
| HTTP client                  | PlaneClient handles X-API-Key injection, workspace path prefix, 429 backoff, error mapping, field normalization                                                                   | `src/plane/client.ts`, `src/plane/errors.ts`, `src/plane/normalize.ts`                                        |
| Config/auth                  | AuthContext: async keychain-or-env resolution (PLANE_MCP_INSTANCE → OS keychain, else PLANE_API_KEY env fallback); ServerConfig: validated config file with per-tool token limits | `src/config.ts`, `src/secrets.ts`, `src/paths.ts`                                                             |
| Logging                      | stderr-only JSON logs; redacts secrets by key                                                                                                                                     | `src/logger.ts`                                                                                               |
| Types                        | Shared type definitions imported via `@types` alias                                                                                                                               | `types/` (plane.ts, mcp.ts, config.ts, logger.ts, common.ts, client.ts, secrets.ts, index.ts)                 |

## Request lifecycle

Walkthrough of a `create_work_item` call end to end:

1. MCP client POSTs a `tools/call` JSON-RPC request to `http://127.0.0.1:3000/mcp`.
2. `Bun.serve` routes the request to the Hono app's `/mcp` handler.
3. `createMcpHandler` (configured with `legacy: 'stateless'`) constructs a fresh `McpServer` and transport per request.
4. The MCP SDK validates `args` against the `create_work_item` tool's `inputSchema` (a zod v4 schema object).
5. `toolHandler` wrapper logs the tool execution start, then invokes the pure `createWorkItem` function.
6. `createWorkItem` destructures `args`, then calls `toWorkItemWriteBody` to translate tool-facing field names
   (e.g., `state_id`, `assignee_ids`, `due_date`) into Plane's wire-shape field names (e.g., `state`, `assignees`,
   `target_date`). Undefined fields are omitted from the wire body.
7. `PlaneClient.post` injects the `X-API-Key` header, prepends the workspace path prefix
   (`/api/v1/workspaces/{workspace}/projects/{project_id}/work-items/`), and POSTs the normalized body.
8. If Plane responds with 429, `PlaneClient` reads `X-RateLimit-Reset`, backs off for up to 30 seconds, and retries up
   to `MAX_RETRIES=3`. After exhaustion, a `PlaneRateLimitError` is thrown.
9. If Plane responds with 2xx, the JSON response is parsed as a `WorkItem` and returned.
10. The tool returns `{ content: [{ type: 'text', text: JSON.stringify(workItem) }], structuredContent: workItem }`.
11. If any `PlaneApiError` is thrown, `toolHandler` catches it and returns `{ content: [{ type: 'text', text: err.message }], isError: true }`.
    Generic (non-Plane) errors surface as `{ content: [{ type: 'text', text: 'Unexpected error' }], isError: true }`.
12. The MCP SDK serializes the result and streams it back to the client via the HTTP response.

## Field-name normalization table

MCP tools expose read-shape field names (matching how retrieved work items look) but must write using Plane's wire-shape
field names. The `toWorkItemWriteBody` function in `src/plane/normalize.ts` handles this mapping:

| Tool-facing arg   | Wire field (Plane) | Notes                                                    |
| ----------------- | ------------------ | -------------------------------------------------------- |
| `stateId`         | `state`            | UUID of the state                                        |
| `assigneeIds`     | `assignees`        | Array of assignee UUIDs                                  |
| `labelIds`        | `labels`           | Array of label UUIDs                                     |
| `dueDate`         | `target_date`      | ISO 8601 date string; note cycles use `end_date` instead |
| `parentId`        | `parent`           | UUID of the parent work item (nullable)                  |
| `descriptionHtml` | `description_html` | HTML description                                         |
| `typeId`          | `type_id`          | UUID of the work item type                               |
| `startDate`       | `start_date`       | ISO 8601 date string                                     |
| `estimatePoint`   | `estimate_point`   | Estimate point value                                     |
| `externalId`      | `external_id`      | External system identifier                               |
| `externalSource`  | `external_source`  | External system name                                     |

Additional normalization:

- **Cycles vs Modules date fields**: Cycles use `end_date` for their completion date, while modules use `target_date`.
  Both work items and modules use `target_date` for due dates.
- **Search query mapping**: The `search_work_items` tool maps the tool-facing `query` argument to the wire field `q`.
- **Undefined fields**: Any undefined fields are omitted from the write body (not sent as `null` or empty string).

## Error handling & rate limiting

**PlaneApiError**: Base error class for all Plane API errors. Contains `status` (HTTP status code) and `body` (raw
response text). Thrown by `PlaneClient` for any 4xx/5xx response. Caught by `toolHandler` and mapped to
`{ isError: true }` tool results with the error message exposed to the MCP client.

**PlaneRateLimitError**: Extends `PlaneApiError` with an additional `resetAt` field (Unix timestamp). Thrown when Plane
responds with 429 and retries are exhausted (after `MAX_RETRIES=3` attempts). `PlaneClient` reads the
`X-RateLimit-Reset` header, backs off for up to 30 seconds, and retries. If the limit is still exceeded after retries,
the error surfaces to the tool caller.

**Error visibility**:

- `PlaneApiError` instances surface their full message to the MCP client.
- Generic errors (not `PlaneApiError` subclasses) surface only `"Unexpected error"` to avoid leaking internals.
- `toolHandler` logs all errors to stderr with full detail (operation, tool name, error message).

**Secret redaction**:

- `PLANE_API_KEY` and `PLANE_WORKSPACE_SLUG` are never logged. The `logger.ts` module redacts any context keys matching
  a predefined set (`REDACTED_KEYS`).
- `PlaneClient.sanitizeEndpoint` replaces the workspace slug in logged endpoint paths with `{workspace}` to prevent
  leaking the slug in logs.

## Security

- **127.0.0.1-only binding**: The server binds to `127.0.0.1` (configured in `src/index.ts` as `hostname: '127.0.0.1'`),
  preventing external network access.
- **HTTPS-only base URL**: `PLANE_BASE_URL` must start with `https://` (validated in `src/config.ts`). Self-signed
  certificates are rejected by default.
- **Env-var auth**: `PLANE_API_KEY` and `PLANE_WORKSPACE_SLUG` are loaded once at startup from environment variables.
  No OAuth, no session state, no per-request authentication negotiation.
- **Single workspace**: One `PLANE_WORKSPACE_SLUG` per server process. No multi-tenant support.
- **No token caching**: The server is stateless; no Redis or other external store for tokens or sessions.

## Non-goals

The following are explicitly out of scope per the RFC (`plans/plane-mcp/00-rfc.md`):

- **OAuth 2.0**: No bot-token or user-token flows, no OAuth proxy, no redirect URIs, no scope negotiation. API-Key
  (Personal/Workspace Access Token) auth only.
- **Redis/Valkey**: No session store, no token cache. Stateless transport means there is no server-side session to
  cache against.
- **Webhooks**: No webhook registration, HMAC verification, or deduplication.
- **SSE (legacy) transport**: Not supported.
- **Full 100+ Plane tool surface**: The server exposes exactly 31 tools covering the core ticket-workflow surface. Out
  of scope: work item properties/types, worklogs, epics, milestones, initiatives, intake, pages, teamspaces, customers,
  stickies, IDP group sync, workspace/project feature toggles, attachments, links, activities. These resources may be
  added in a future RFC if needed.
- **Multi-workspace / multi-tenant support**: One `PLANE_WORKSPACE_SLUG` per server process.
- **Auto-pagination**: `list_*` tools return the raw pagination envelope (with `next_cursor`, `prev_cursor`,
  `total_count`). The calling model drives cursor iteration. Tools never auto-page through all results.
