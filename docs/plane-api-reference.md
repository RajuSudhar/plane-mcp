# Plane MCP Tool — Complete Design & API Specification

> **End-to-end reference for building a Model Context Protocol (MCP) server for Plane** ([makeplane/plane](https://github.com/makeplane/plane)) — with both **stdio** and **remote HTTP** transports, and support for both **OAuth 2.0** and **API-Key (PAT)** authentication.

---

## 0. Before you start — the "should you build this?" question

Plane already ships an **official, MIT-licensed MCP server** — [`makeplane/plane-mcp-server`](https://github.com/makeplane/plane-mcp-server) (Python + FastMCP). It's hosted for Plane Cloud users at `https://mcp.plane.so`, self-hostable via Docker Compose or Helm, exposes **100+ tools across ~20 modules**, and already supports all four transports (stdio, HTTP+OAuth, HTTP+PAT, legacy SSE).

Practical takeaways before you write code:

| If you want…                                                                | Recommended path                                                                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Fastest working integration for Plane Cloud                                 | Just point your client at `https://mcp.plane.so/http/mcp` (OAuth) or `.../http/api-key/mcp` (PAT). No build needed.                  |
| Self-hosted Plane, minimal custom logic                                     | Self-host the official server (Docker Compose / Helm — see §11).                                                                    |
| Custom tool set (filtered/narrower), domain-specific prompts, extra plumbing (Slack fan-out, dashboards, workflows) | **Build your own**, using this spec. You can still copy structure/patterns from the official server. |
| Different language (TS/Go/Rust) or non-FastMCP framework                    | **Build your own** — the official server is Python-only.                                                                            |

The rest of this document assumes you're **building your own**. Everything here also holds as a reference guide even if you decide to fork the official one.

---

## 1. Architecture at a glance

```
┌────────────────────────┐        ┌─────────────────────────┐        ┌────────────────────┐
│   MCP Client           │        │   Your MCP Server       │        │   Plane Backend    │
│   (Claude Desktop,     │ MCP    │   (this spec)           │  HTTPS │   (Cloud or        │
│   Claude.ai, Cursor,   │◄──────►│                         │◄──────►│   Self-hosted)     │
│   VS Code, Windsurf,   │        │  ┌───────────────────┐  │        │                    │
│   Zed, Claude Code)    │        │  │ Transport layer   │  │        │  /api/v1/…         │
└────────────────────────┘        │  │  · stdio          │  │        │  /auth/o/…         │
                                  │  │  · streamable HTTP│  │        └────────────────────┘
                                  │  │  · SSE (legacy)   │  │
                                  │  ├───────────────────┤  │
                                  │  │ Auth resolver     │  │
                                  │  │  · API Key (PAT)  │  │
                                  │  │  · OAuth Bearer   │  │
                                  │  │  · env vars       │  │
                                  │  ├───────────────────┤  │
                                  │  │ Plane API client  │  │
                                  │  │  (typed, retries) │  │
                                  │  ├───────────────────┤  │
                                  │  │ Tool registry     │  │
                                  │  │  (100+ MCP tools) │  │
                                  │  └───────────────────┘  │
                                  └─────────────────────────┘
```

### The three-way matrix

| Transport         | Where it runs                        | How the token gets in                          | Best for                        |
| ----------------- | ------------------------------------ | ---------------------------------------------- | ------------------------------- |
| **stdio**         | Local subprocess of the MCP client   | Environment variables                          | Local dev, self-hosted Plane, Claude Desktop, IDEs |
| **HTTP + OAuth**  | Remote server (single URL for team)  | Browser OAuth flow → Bearer token per request  | Cloud users, Claude.ai web, easy onboarding |
| **HTTP + PAT**    | Remote server (single URL for team)  | `X-API-Key` + `X-Workspace-Slug` headers       | CI/CD, headless bots, scripts   |
| **SSE (legacy)**  | Remote server                        | Browser OAuth                                  | Backward compat only — do not build new integrations on this |

You should implement **stdio + streamable HTTP** (the two current MCP-spec-blessed transports). SSE is deprecated by the MCP spec; only support it if you must.

---

## 2. Plane REST API — the base you're wrapping

Everything the MCP server does is a wrapper around Plane's REST API. Get this layer right and the MCP layer becomes mechanical.

### 2.1 Base URLs

| Environment    | Base URL                                    |
| -------------- | ------------------------------------------- |
| Plane Cloud    | `https://api.plane.so`                      |
| Self-hosted    | `https://<your-plane-domain>` (from config) |

All API paths in this document are prefixed with `/api/v1/`. Most are scoped to a workspace: `/api/v1/workspaces/{workspace_slug}/…`.

### 2.2 Authentication — two mechanisms, one target

Plane's public API accepts two credential types **interchangeably**. Every documented endpoint works with either.

#### 2.2.1 API Key (Personal or Workspace Access Token)

- Header: `X-API-Key: <token>`
- Two kinds of tokens exist:
  - **Personal Access Token (PAT)** — created at *Profile Settings → Personal Access Tokens*. Acts as the individual user.
  - **Workspace Access Token** — created at *Workspace Settings → Access Tokens*. Acts as a workspace-scoped bot.
- Tokens can have optional expiry.
- Keep the token confidential. If leaked, regenerate.
- The token is scoped to the user/workspace that created it — no explicit scope negotiation.

#### 2.2.2 OAuth 2.0 access token

- Header: `Authorization: Bearer <access_token>`
- Token issued by Plane's OAuth server after a user installs your app.
- Scoped to whatever OAuth scopes were granted at install time (see §4.2).

**Practical note for the MCP server:** treat these as interchangeable at the HTTP layer. Your Plane API client should accept either credential type and just set the correct header — no per-endpoint logic.

### 2.3 HTTP verbs, status codes, and errors

| Verb   | Semantics                                     |
| ------ | --------------------------------------------- |
| GET    | Read a resource                               |
| POST   | Create a new resource                         |
| PATCH  | Partial update                                |
| DELETE | Remove a resource                             |

| Success | Meaning                                                       |
| ------- | ------------------------------------------------------------- |
| 200 OK  | Successful GET / PATCH                                        |
| 201     | Resource created (POST or occasionally PATCH)                 |
| 204     | No content — used for DELETE                                  |

| Error | Meaning                                                                   |
| ----- | ------------------------------------------------------------------------- |
| 400   | Bad request (bad body, missing field)                                     |
| 401   | Unauthenticated — missing/invalid token                                   |
| 403   | Authenticated but not permitted (role too low, wrong workspace)           |
| 404   | Not found — bad URL or resource doesn't exist                             |
| 429   | Rate-limited — retry after `X-RateLimit-Reset`                            |
| 500   | Server error                                                              |
| 502 / 503 / 504 | Gateway / unavailability                                        |

### 2.4 Pagination (cursor-based)

Cursor format: `value:offset:is_prev` where `value` is page size, `offset` is 0-indexed page number, `is_prev` is `0` or `1`.

Request:

```
GET /api/v1/workspaces/{slug}/projects/{pid}/work-items/?per_page=20&cursor=20:1:0
```

Response envelope:

```json
{
  "next_cursor": "20:2:0",
  "prev_cursor": "20:0:1",
  "next_page_results": true,
  "prev_page_results": true,
  "count": 20,
  "total_pages": 50,
  "total_results": 1000,
  "extra_stats": {},
  "results": [ /* … */ ]
}
```

Defaults: `per_page=100`, max `per_page=100`.

**MCP tool implication:** every `list_*` tool should accept `cursor`, `per_page`, and return the raw pagination envelope so the model can iterate. Don't auto-page inside the tool — models handle it fine.

### 2.5 Rate limiting

- **60 requests per minute per API key**, sliding window.
- Response headers:
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset` (UTC epoch seconds)
- On 429, back off until reset, then retry. Your MCP server should not silently swallow 429s — surface them as tool errors so the model can pause.

### 2.6 Field selection and expansion

Two query parameters everywhere:

- `fields=id,name,description` — subset the response.
- `expand=assignees,state` — inline related objects (avoids N+1 fetches).

Invalid `fields` or `expand` values return 400 with an explanatory message. Your MCP `list_*` and `retrieve_*` tools should pass these through as optional strings.

---

## 3. Complete API surface — every endpoint

This is the full list of resources exposed by `/api/v1/`. Path pattern conventions: `{workspace_slug}` is always in the URL, `{project_id}`/`{work_item_id}`/etc. are UUIDs. The Scope column lists the OAuth scope required (API-Key auth doesn't check scopes but respects role).

### 3.1 Workspace-scoped resources

| Resource                | Method | Path                                                                           | Scope                             |
| ----------------------- | ------ | ------------------------------------------------------------------------------ | --------------------------------- |
| **Current user**        | GET    | `/api/v1/users/me/`                                                            | `profile:read`                    |
| **Workspace members**   | GET    | `/api/v1/workspaces/{slug}/members/`                                           | `workspaces.members:read`         |
| **Workspace members**   | DELETE | `/api/v1/workspaces/{slug}/members/{member_id}/`                               | `workspaces.members:write`        |
| **Workspace invitations** | GET  | `/api/v1/workspaces/{slug}/invitations/`                                       | `workspaces.members:read`         |
| **Workspace invitations** | POST | `/api/v1/workspaces/{slug}/invitations/`                                       | `workspaces.members:write`        |
| **Workspace invitations** | GET  | `/api/v1/workspaces/{slug}/invitations/{invitation_id}/`                       | `workspaces.members:read`         |
| **Workspace invitations** | PATCH | `/api/v1/workspaces/{slug}/invitations/{invitation_id}/`                      | `workspaces.members:write`        |
| **Workspace invitations** | DELETE | `/api/v1/workspaces/{slug}/invitations/{invitation_id}/`                     | `workspaces.members:write`        |
| **Workspace features**  | GET    | `/api/v1/workspaces/{slug}/features/`                                          | `workspaces.features:read`        |
| **Workspace features**  | PATCH  | `/api/v1/workspaces/{slug}/features/`                                          | `workspaces.features:write`       |
| **Workspace pages**     | GET/POST | `/api/v1/workspaces/{slug}/pages/`                                           | `wiki.pages:read` / `:write`      |
| **Workspace page**      | GET    | `/api/v1/workspaces/{slug}/pages/{page_id}/`                                   | `wiki.pages:read`                 |
| **Workspace assets**    | POST   | `/api/v1/workspaces/{slug}/assets/` (create upload)                            | `assets:write`                    |
| **Workspace assets**    | GET    | `/api/v1/workspaces/{slug}/assets/{asset_id}/`                                 | `assets:read`                     |
| **Workspace assets**    | PATCH  | `/api/v1/workspaces/{slug}/assets/{asset_id}/`                                 | `assets:write`                    |
| **User assets**         | POST/PATCH/DELETE | `/api/v1/users/{user_id}/assets/…`                                | `assets:write`                    |

### 3.2 Projects

| Method | Path                                                             | Scope               |
| ------ | ---------------------------------------------------------------- | ------------------- |
| GET    | `/api/v1/workspaces/{slug}/projects/`                            | `projects:read`     |
| POST   | `/api/v1/workspaces/{slug}/projects/`                            | `projects:write`    |
| POST   | `/api/v1/workspaces/{slug}/projects/from-template/`              | `projects:write`    |
| GET    | `/api/v1/workspaces/{slug}/projects/{project_id}/`               | `projects:read`     |
| PATCH  | `/api/v1/workspaces/{slug}/projects/{project_id}/`               | `projects:write`    |
| POST   | `/api/v1/workspaces/{slug}/projects/{project_id}/archive/`       | `projects:write`    |
| POST   | `/api/v1/workspaces/{slug}/projects/{project_id}/unarchive/`     | `projects:write`    |
| DELETE | `/api/v1/workspaces/{slug}/projects/{project_id}/`               | `projects:write`    |

### 3.3 Project features & members

| Method | Path                                                                        | Scope                       |
| ------ | --------------------------------------------------------------------------- | --------------------------- |
| GET    | `/api/v1/workspaces/{slug}/projects/{project_id}/features/`                 | `projects.features:read`    |
| PATCH  | `/api/v1/workspaces/{slug}/projects/{project_id}/features/`                 | `projects.features:write`   |
| GET    | `/api/v1/workspaces/{slug}/projects/{project_id}/members/`                  | `projects.members:read`     |
| POST   | `/api/v1/workspaces/{slug}/projects/{project_id}/members/`                  | `projects.members:write`    |
| GET    | `/api/v1/workspaces/{slug}/projects/{project_id}/members/{member_id}/`      | `projects.members:read`     |
| PATCH  | `/api/v1/workspaces/{slug}/projects/{project_id}/members/{member_id}/`      | `projects.members:write`    |
| DELETE | `/api/v1/workspaces/{slug}/projects/{project_id}/members/{member_id}/`      | `projects.members:write`    |

### 3.4 Project labels

| Method | Path                                                                        | Scope                     |
| ------ | --------------------------------------------------------------------------- | ------------------------- |
| GET    | `/api/v1/workspaces/{slug}/projects/{project_id}/labels/`                   | `projects.labels:read`    |
| POST   | `/api/v1/workspaces/{slug}/projects/{project_id}/labels/`                   | `projects.labels:write`   |
| GET    | `/api/v1/workspaces/{slug}/projects/{project_id}/labels/{label_id}/`        | `projects.labels:read`    |
| PATCH  | `/api/v1/workspaces/{slug}/projects/{project_id}/labels/{label_id}/`        | `projects.labels:write`   |
| DELETE | `/api/v1/workspaces/{slug}/projects/{project_id}/labels/{label_id}/`        | `projects.labels:write`   |

### 3.5 Work items (issues)

| Method | Path                                                                                       | Scope                              |
| ------ | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-items/`                                     | `projects.work_items:read`         |
| POST   | `/api/v1/workspaces/{slug}/projects/{pid}/work-items/`                                     | `projects.work_items:write`        |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-items/{wid}/`                               | `projects.work_items:read`         |
| PATCH  | `/api/v1/workspaces/{slug}/projects/{pid}/work-items/{wid}/`                               | `projects.work_items:write`        |
| DELETE | `/api/v1/workspaces/{slug}/projects/{pid}/work-items/{wid}/`                               | `projects.work_items:write`        |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-items/identifier/{project_identifier}-{sequence_id}/` | `projects.work_items:read`  |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-items/search/?q=…`                          | `projects.work_items:read`         |
| GET    | `/api/v1/workspaces/{slug}/work-items/search/` (advanced, workspace-wide with filters)     | `projects.work_items:read`         |

### 3.6 Work item states

| Method | Path                                                                              | Scope                       |
| ------ | --------------------------------------------------------------------------------- | --------------------------- |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/states/`                                | `projects.states:read`      |
| POST   | `/api/v1/workspaces/{slug}/projects/{pid}/states/`                                | `projects.states:write`     |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/states/{state_id}/`                     | `projects.states:read`      |
| PATCH  | `/api/v1/workspaces/{slug}/projects/{pid}/states/{state_id}/`                     | `projects.states:write`     |
| DELETE | `/api/v1/workspaces/{slug}/projects/{pid}/states/{state_id}/`                     | `projects.states:write`     |

### 3.7 Work item labels (project-scoped, distinct from project labels — same endpoints; kept here for clarity)

Same as §3.4.

### 3.8 Work item types (custom types like Bug/Feature/Epic)

| Method | Path                                                                                                       | Scope                                  |
| ------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-item-types/`                                                | `projects.work_item_types:read`        |
| POST   | `/api/v1/workspaces/{slug}/projects/{pid}/work-item-types/`                                                | `projects.work_item_types:write`       |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-item-types/{type_id}/`                                      | `projects.work_item_types:read`        |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-item-types/{type_id}/schema/`                               | `projects.work_item_types:read`        |
| PATCH  | `/api/v1/workspaces/{slug}/projects/{pid}/work-item-types/{type_id}/`                                      | `projects.work_item_types:write`       |
| DELETE | `/api/v1/workspaces/{slug}/projects/{pid}/work-item-types/{type_id}/`                                      | `projects.work_item_types:write`       |

### 3.9 Custom properties (per work-item-type)

| Method | Path                                                                                                                              | Scope                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-item-types/{tid}/properties/`                                                      | `projects.work_item_properties:read`           |
| POST   | `/api/v1/workspaces/{slug}/projects/{pid}/work-item-types/{tid}/properties/`                                                      | `projects.work_item_properties:write`          |
| GET    | `…/properties/{property_id}/`                                                                                                     | `projects.work_item_properties:read`           |
| PATCH  | `…/properties/{property_id}/`                                                                                                     | `projects.work_item_properties:write`          |
| DELETE | `…/properties/{property_id}/`                                                                                                     | `projects.work_item_properties:write`          |
| GET    | `…/properties/{property_id}/options/`                                                                                             | `projects.work_item_property_options:read`     |
| POST   | `…/properties/{property_id}/options/`                                                                                             | `projects.work_item_property_options:write`    |
| GET/PATCH/DELETE | `…/properties/{property_id}/options/{option_id}/`                                                                       | `projects.work_item_property_options:*`        |
| GET    | `/api/v1/workspaces/{slug}/projects/{pid}/work-items/{wid}/property-values/`                                                      | `projects.work_item_property_values:read`      |
| POST   | `…/property-values/`                                                                                                              | `projects.work_item_property_values:write`     |
| GET/PATCH/DELETE | `…/property-values/{value_id}/`                                                                                         | `projects.work_item_property_values:*`         |

### 3.10 Work item comments / links / activity / worklogs / attachments / page links / relations

| Resource       | Method | Path                                                                                                           | Scope                                          |
| -------------- | ------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Comments       | GET/POST | `…/work-items/{wid}/comments/`                                                                              | `projects.work_items.comments:read/write`      |
| Comments       | GET/PATCH/DELETE | `…/work-items/{wid}/comments/{comment_id}/`                                                        | `projects.work_items.comments:*`               |
| Links          | GET/POST | `…/work-items/{wid}/links/`                                                                                 | `projects.work_items.links:read/write`         |
| Links          | GET/PATCH/DELETE | `…/work-items/{wid}/links/{link_id}/`                                                              | `projects.work_items.links:*`                  |
| Activity       | GET    | `…/work-items/{wid}/activities/`                                                                               | `projects.work_items.activities:read`          |
| Activity       | GET    | `…/work-items/{wid}/activities/{activity_id}/`                                                                 | `projects.work_items.activities:read`          |
| Worklogs       | GET/POST | `…/work-items/{wid}/worklogs/`                                                                              | `projects.work_items.worklogs:read/write`      |
| Worklogs       | PATCH/DELETE | `…/work-items/{wid}/worklogs/{worklog_id}/`                                                            | `projects.work_items.worklogs:write`           |
| Worklogs (project total) | GET | `…/projects/{pid}/worklogs/total-time/`                                                              | `projects.work_items.worklogs:read`            |
| Attachments    | GET    | `…/work-items/{wid}/attachments/`                                                                              | `projects.work_items.attachments:read`         |
| Attachments    | POST   | `…/work-items/{wid}/attachments/` (get upload credentials)                                                     | `projects.work_items.attachments:write`        |
| Attachments    | POST   | `…/work-items/{wid}/attachments/{aid}/complete/` (mark upload done)                                            | `projects.work_items.attachments:write`        |
| Attachments    | GET/PATCH/DELETE | `…/work-items/{wid}/attachments/{aid}/`                                                            | `projects.work_items.attachments:*`            |
| Relations      | GET/POST | `…/work-items/{wid}/relations/`                                                                             | `projects.work_items.relations:read/write`     |
| Relations      | DELETE | `…/work-items/{wid}/relations/{relation_id}/`                                                                  | `projects.work_items.relations:write`          |
| Page links     | GET/POST | `…/work-items/{wid}/page-links/`                                                                            | `projects.work_items:read/write`               |
| Page links     | GET/DELETE | `…/work-items/{wid}/page-links/{link_id}/`                                                                | `projects.work_items:read/write`               |

### 3.11 Cycles (sprints)

| Method | Path                                                                                | Scope                        |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------- |
| GET    | `…/projects/{pid}/cycles/`                                                          | `projects.cycles:read`       |
| POST   | `…/projects/{pid}/cycles/`                                                          | `projects.cycles:write`      |
| GET    | `…/projects/{pid}/cycles/{cycle_id}/`                                               | `projects.cycles:read`       |
| PATCH  | `…/projects/{pid}/cycles/{cycle_id}/`                                               | `projects.cycles:write`      |
| DELETE | `…/projects/{pid}/cycles/{cycle_id}/`                                               | `projects.cycles:write`      |
| POST   | `…/projects/{pid}/cycles/{cycle_id}/archive/`                                       | `projects.cycles:write`      |
| POST   | `…/projects/{pid}/cycles/{cycle_id}/unarchive/`                                     | `projects.cycles:write`      |
| GET    | `…/projects/{pid}/cycles/archived/`                                                 | `projects.cycles:read`       |
| GET    | `…/projects/{pid}/cycles/{cycle_id}/work-items/`                                    | `projects.cycles:read`       |
| POST   | `…/projects/{pid}/cycles/{cycle_id}/work-items/` (add work items)                   | `projects.cycles:write`      |
| DELETE | `…/projects/{pid}/cycles/{cycle_id}/work-items/{wid}/`                              | `projects.cycles:write`      |
| POST   | `…/projects/{pid}/cycles/{cycle_id}/transfer-work-items/`                           | `projects.cycles:write`      |

### 3.12 Modules

| Method | Path                                                                                | Scope                        |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------- |
| GET/POST | `…/projects/{pid}/modules/`                                                       | `projects.modules:read/write` |
| GET/PATCH/DELETE | `…/projects/{pid}/modules/{module_id}/`                                   | `projects.modules:*`         |
| POST   | `…/projects/{pid}/modules/{module_id}/archive/`                                     | `projects.modules:write`     |
| POST   | `…/projects/{pid}/modules/{module_id}/unarchive/`                                   | `projects.modules:write`     |
| GET    | `…/projects/{pid}/modules/archived/`                                                | `projects.modules:read`      |
| GET/POST | `…/projects/{pid}/modules/{module_id}/work-items/`                                | `projects.modules:*`         |
| DELETE | `…/projects/{pid}/modules/{module_id}/work-items/{wid}/`                            | `projects.modules:write`     |

### 3.13 Pages

| Method | Path                                                                                | Scope                        |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------- |
| GET/POST | `/api/v1/workspaces/{slug}/pages/`                                                | `wiki.pages:read/write`      |
| GET    | `/api/v1/workspaces/{slug}/pages/{page_id}/`                                        | `wiki.pages:read`            |
| GET/POST | `…/projects/{pid}/pages/`                                                         | `projects.pages:read/write`  |
| GET    | `…/projects/{pid}/pages/{page_id}/`                                                 | `projects.pages:read`        |

### 3.14 Intake (triage queue)

| Method | Path                                                                                | Scope                        |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------- |
| GET/POST | `…/projects/{pid}/intake-issues/`                                                 | `projects.intakes:read/write` |
| GET/PATCH/DELETE | `…/projects/{pid}/intake-issues/{intake_id}/`                             | `projects.intakes:*`         |

### 3.15 Epics

| Method | Path                                                                                | Scope                        |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------- |
| GET/POST | `…/projects/{pid}/epics/`                                                         | `projects.epics:read/write`  |
| GET/PATCH/DELETE | `…/projects/{pid}/epics/{epic_id}/`                                       | `projects.epics:*`           |
| GET/POST | `…/projects/{pid}/epics/{epic_id}/work-items/`                                    | `projects.epics:*`           |

### 3.16 Milestones

| Method | Path                                                                                | Scope                            |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| GET/POST | `…/projects/{pid}/milestones/`                                                    | `projects.milestones:read/write` |
| GET/PATCH/DELETE | `…/projects/{pid}/milestones/{milestone_id}/`                             | `projects.milestones:*`          |
| GET/POST | `…/projects/{pid}/milestones/{milestone_id}/work-items/`                          | `projects.milestones:*`          |
| DELETE | `…/projects/{pid}/milestones/{milestone_id}/work-items/{wid}/`                      | `projects.milestones:write`      |

### 3.17 Estimates (story-point systems)

| Method | Path                                                                                | Scope                        |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------- |
| GET/POST | `…/projects/{pid}/estimates/`                                                     | `projects.work_items:read/write` |
| GET/PATCH/DELETE | `…/projects/{pid}/estimates/{estimate_id}/`                               | `projects.work_items:*`      |
| GET/POST | `…/projects/{pid}/estimates/{estimate_id}/points/`                                | `projects.work_items:*`      |
| PATCH/DELETE | `…/projects/{pid}/estimates/{estimate_id}/points/{point_id}/`                 | `projects.work_items:write`  |

### 3.18 Initiatives (workspace-scoped, cross-project goals)

| Method | Path                                                                                    | Scope                              |
| ------ | --------------------------------------------------------------------------------------- | ---------------------------------- |
| GET/POST | `/api/v1/workspaces/{slug}/initiatives/`                                              | `initiatives:read/write`           |
| GET/PATCH/DELETE | `/api/v1/workspaces/{slug}/initiatives/{init_id}/`                            | `initiatives:*`                    |
| GET/POST | `…/initiatives/{init_id}/labels/`                                                     | `initiatives.labels:*`             |
| GET/PATCH/DELETE | `…/initiatives/{init_id}/labels/{label_id}/`                                  | `initiatives.labels:*`             |
| GET/POST | `…/initiatives/{init_id}/projects/`                                                   | `initiatives.projects:*`           |
| DELETE | `…/initiatives/{init_id}/projects/{project_id}/`                                        | `initiatives.projects:write`       |
| GET/POST | `…/initiatives/{init_id}/epics/`                                                      | `initiatives.epics:*`              |
| DELETE | `…/initiatives/{init_id}/epics/{epic_id}/`                                              | `initiatives.epics:write`          |

### 3.19 Customers

| Method | Path                                                                                    | Scope                                 |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------- |
| GET/POST | `/api/v1/workspaces/{slug}/customers/`                                                | `customers:read/write`                |
| GET/PATCH/DELETE | `…/customers/{customer_id}/`                                                  | `customers:*`                         |
| POST/DELETE | `…/customers/{customer_id}/work-items/` (link/unlink)                              | `customers.work_items:write`          |
| GET    | `…/customers/{customer_id}/work-items/`                                                 | `customers.work_items:read`           |
| GET/POST | `…/customers/{customer_id}/requests/`                                                 | `customers.requests:*`                |
| GET/PATCH/DELETE | `…/customers/{customer_id}/requests/{req_id}/`                                | `customers.requests:*`                |
| GET/POST | `…/customers/properties/`                                                             | `customers.properties:*`              |
| GET/PATCH/DELETE | `…/customers/properties/{prop_id}/`                                           | `customers.properties:*`              |
| GET/PATCH | `…/customers/{customer_id}/property-values/` and `…/{value_id}/`                     | `customers.property_values:*`         |

### 3.20 Teamspaces (grouping of members/projects)

| Method | Path                                                                                    | Scope                            |
| ------ | --------------------------------------------------------------------------------------- | -------------------------------- |
| GET/POST | `/api/v1/workspaces/{slug}/teamspaces/`                                               | `teamspaces:read/write`          |
| GET/PATCH/DELETE | `…/teamspaces/{team_id}/`                                                     | `teamspaces:*`                   |
| GET/POST/DELETE | `…/teamspaces/{team_id}/members/`                                              | `teamspaces.members:*`           |
| GET/POST/DELETE | `…/teamspaces/{team_id}/projects/`                                             | `teamspaces.projects:*`          |

### 3.21 Stickies (personal quick notes)

| Method | Path                                                                                    | Scope                            |
| ------ | --------------------------------------------------------------------------------------- | -------------------------------- |
| GET/POST | `/api/v1/workspaces/{slug}/stickies/`                                                 | `stickies:read/write`            |
| GET/PATCH/DELETE | `…/stickies/{sticky_id}/`                                                     | `stickies:*`                     |

### 3.22 IDP Group Sync (enterprise)

| Method | Path                                                                                    | Scope         |
| ------ | --------------------------------------------------------------------------------------- | ------------- |
| GET/PATCH | `…/idp-group-sync/config/`                                                            | admin-only    |
| GET/POST | `…/idp-group-sync/project-mappings/`                                                  | admin-only    |
| GET/PATCH/DELETE | `…/idp-group-sync/project-mappings/{mapping_id}/`                             | admin-only    |
| GET/POST | `…/idp-group-sync/workspace-mappings/`                                                | admin-only    |
| GET/PATCH/DELETE | `…/idp-group-sync/workspace-mappings/{mapping_id}/`                           | admin-only    |

### 3.23 OpenAPI machine-readable spec (self-hosted feature)

If you need the exact schema for any endpoint, enable Plane's OpenAPI generator on any Plane instance:

- Set env var `ENABLE_DRF_SPECTACULAR=1` in `apps/api/.env` on your Plane instance.
- Endpoints served after restart:
  - `GET https://{your_plane_domain}/api/schema/` → OpenAPI 3.0 YAML
  - `GET https://{your_plane_domain}/api/schema/?format=openapi-json` → JSON
  - `GET .../api/schema/swagger-ui/` → Swagger UI
  - `GET .../api/schema/redoc/` → ReDoc

Offline generation:

```bash
cd apps/api/
ENABLE_DRF_SPECTACULAR=1 python manage.py spectacular --file openapi.yaml
```

Feed this OpenAPI file into your MCP server's build step to auto-generate the Plane API client (a codegen once, then hand-tune types).

---

## 4. Authentication — deep dive

### 4.1 API Key path (simplest — recommended default for MCP)

1. **User generates the token in Plane:**
   - *Profile Settings → Personal Access Tokens* (or *Workspace Settings → Access Tokens* for a shared workspace bot token).
   - Set title, optional description, optional expiry.
   - Copy the token — it's shown once.
2. **Config the MCP server:**
   - stdio: `PLANE_API_KEY` env var + `PLANE_WORKSPACE_SLUG` env var + optional `PLANE_BASE_URL` (defaults to `https://api.plane.so`).
   - Remote HTTP+PAT: pass via headers per request: `X-API-Key: <token>` and `X-Workspace-Slug: <slug>`.
3. **Every Plane API call:** attach header `X-API-Key: <token>`.

**Verification call** (always do this once at startup so a bad token fails fast, not on tool use):

```bash
curl -H "X-API-Key: $PLANE_API_KEY" \
  "https://api.plane.so/api/v1/users/me/"
# 200 → good; 401 → bad token; 404 → wrong base URL
```

### 4.2 OAuth 2.0 — the two flows

Plane's OAuth server lives under `/auth/o/`. There are two grant types.

#### 4.2.1 Bot Token flow (client credentials) — for agents / automation

Use when the app acts as itself (bot), not as a specific user. **This is the recommended flow for most MCP servers.**

1. **User clicks Install → your app redirects to Plane's consent screen:**
    ```
    GET https://api.plane.so/auth/o/authorize-app/
       ?client_id=YOUR_CLIENT_ID
       &response_type=code
       &redirect_uri=https://your-mcp.example.com/callback
       &scope=projects:read%20projects.work_items:write%20…
    ```
2. **User approves → Plane redirects to your callback:**
    ```
    GET https://your-mcp.example.com/callback
       ?app_installation_id=<install-uuid>
       &code=<ignored-in-bot-flow>
    ```
3. **Server exchanges install ID for bot token:**
    ```http
    POST https://api.plane.so/auth/o/token/
    Content-Type: application/x-www-form-urlencoded
    Authorization: Basic base64(client_id:client_secret)

    grant_type=client_credentials
    &app_installation_id=<install-uuid>
    &scope=projects:read projects.work_items:write …
    ```
    Response:
    ```json
    {
      "access_token": "pln_bot_xxxxxxxxxxxx",
      "token_type": "Bearer",
      "expires_in": 86400,
      "scope": "projects:read projects.work_items:write …"
    }
    ```
4. **Fetch workspace details so you know which workspace slug to use:**
    ```http
    GET https://api.plane.so/auth/o/app-installation/?id=<install-uuid>
    Authorization: Bearer <bot-token>
    ```
    Response:
    ```json
    [{
      "id": "<install-uuid>",
      "workspace": "<workspace-uuid>",
      "workspace_detail": { "name": "Acme", "slug": "acme" },
      "app_bot": "<bot-user-uuid>",
      "status": "installed"
    }]
    ```
    Store `workspace_detail.slug` and `app_installation_id` — you need them going forward.
5. **Refresh** by repeating step 3 (bot tokens expire; there's no separate refresh token — just re-issue with the install ID).

#### 4.2.2 User Token flow (authorization code) — for act-as-user

Use only when your MCP must perform actions as the specific end user (e.g., attribution matters, or the user's permissions differ per project).

1. **Redirect to authorize:**
    ```
    GET https://api.plane.so/auth/o/authorize-app/
       ?client_id=YOUR_CLIENT_ID
       &response_type=code
       &redirect_uri=https://your-mcp.example.com/callback
       &state=<random-csrf-token>
       &scope=projects:read projects.work_items:write …
    ```
2. **Callback:**
    ```
    GET https://your-mcp.example.com/callback?code=<code>&state=<same-csrf>
    ```
    Verify `state` matches. Reject if not.
3. **Exchange code for tokens:**
    ```http
    POST https://api.plane.so/auth/o/token/
    Content-Type: application/x-www-form-urlencoded

    grant_type=authorization_code
    &code=<code>
    &client_id=YOUR_CLIENT_ID
    &client_secret=YOUR_CLIENT_SECRET
    &redirect_uri=https://your-mcp.example.com/callback
    ```
    Response includes both `access_token` and `refresh_token`:
    ```json
    {
      "access_token": "pln_xxxxxxxxxxxx",
      "refresh_token": "pln_refresh_xxxxxxxxxxxx",
      "token_type": "Bearer",
      "expires_in": 86400,
      "scope": "projects:read …"
    }
    ```
4. **Refresh:**
    ```http
    POST https://api.plane.so/auth/o/token/
    Content-Type: application/x-www-form-urlencoded

    grant_type=refresh_token
    &refresh_token=<refresh-token>
    &client_id=YOUR_CLIENT_ID
    &client_secret=YOUR_CLIENT_SECRET
    ```

#### 4.2.3 Register your OAuth app (one-time, per Plane workspace)

1. Go to *Workspace Settings → Integrations* (URL: `https://<plane-domain>/<workspace>/settings/integrations/`).
2. Click **Build your own**.
3. Fields to fill:

    | Field           | For an MCP server                                                                             |
    | --------------- | --------------------------------------------------------------------------------------------- |
    | App Name        | e.g. `Acme Plane MCP`                                                                         |
    | Setup URL       | Public URL of the MCP server, e.g. `https://mcp.acme.com`                                     |
    | Redirect URI    | Space-separated. If following the official server's model, list all three:                    |
    |                 | `https://mcp.acme.com/callback` (generic)                                                     |
    |                 | `https://mcp.acme.com/http/auth/callback` (HTTP transport)                                    |
    |                 | `https://mcp.acme.com/auth/callback` (SSE legacy)                                             |
    | Webhook URL     | Leave empty unless you also want to consume webhooks server-side                              |
    | Scopes          | Pick per §4.3 — for a general assistant, request read+write on projects, work_items, cycles, modules, comments, links, worklogs, labels, states, pages, plus `profile:read` |
4. Store `Client ID` and `Client Secret` in a secret manager. Never commit them.

#### 4.2.4 OAuth redirect URIs for popular MCP clients

If you're routing OAuth flows straight back to the MCP client (rather than back to your server), Plane's official server registers these client-native URI schemes. Register the same set if you want to support the same clients:

- `cursor://`
- `vscode://`
- `vscode-insiders://`
- `windsurf://`
- `claude://`

### 4.3 OAuth scope reference — the complete list

Request the minimum needed. Scopes are space-separated.

#### Profile

| Scope             | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `profile:read`    | `GET /api/v1/users/me/`                              |

#### Projects

| Scope                                       | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `projects:read` / `projects:write`          | CRUD on projects                              |
| `projects.features:read` / `:write`         | Project feature toggles                       |
| `projects.members:read` / `:write`          | Project membership                            |
| `projects.states:read` / `:write`           | Workflow states                               |
| `projects.labels:read` / `:write`           | Labels                                        |
| `projects.intakes:read` / `:write`          | Intake queue                                  |
| `projects.epics:read` / `:write`            | Epics                                         |
| `projects.cycles:read` / `:write`           | Sprints                                       |
| `projects.pages:read` / `:write`            | Project pages                                 |
| `projects.modules:read` / `:write`          | Modules                                       |
| `projects.milestones:read` / `:write`       | Milestones                                    |
| `projects.work_items:read` / `:write`       | Work items                                    |
| `projects.work_items.comments:read` / `:write` | Comments                                   |
| `projects.work_items.attachments:read` / `:write` | Attachments                             |
| `projects.work_items.links:read` / `:write` | External URL links on a work item             |
| `projects.work_items.relations:read` / `:write` | Blocks / blocked-by / duplicate / relates |
| `projects.work_items.activities:read` / `:write` | Activity log                             |
| `projects.work_items.worklogs:read` / `:write` | Time tracking                              |
| `projects.work_item_types:read` / `:write`  | Custom work item types                        |
| `projects.work_item_properties:read` / `:write` | Custom properties                         |
| `projects.work_item_property_options:read` / `:write` | Dropdown options                    |
| `projects.work_item_property_values:read` / `:write`  | Property values on work items       |

#### Workspaces

| Scope                                       | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `workspaces.members:read` / `:write`        | Workspace membership + invitations            |
| `workspaces.features:read` / `:write`       | Feature toggles                               |

#### Wiki / Assets / Stickies

| Scope                                       | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `wiki.pages:read` / `wiki.pages:write`      | Workspace-level pages                         |
| `assets:read` / `assets:write`              | File assets                                   |
| `stickies:read` / `stickies:write`          | Personal quick notes                          |

#### Customers

| Scope                                       | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `customers:read` / `customers:write`        | Customers                                     |
| `customers.requests:read` / `:write`        | Customer feature requests                     |
| `customers.properties:read` / `:write`      | Custom properties                             |
| `customers.property_values:read` / `:write` | Property values                               |
| `customers.work_items:read` / `:write`      | Linking work items to customers               |

#### Initiatives

| Scope                                       | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `initiatives:read` / `:write`               | Initiatives                                   |
| `initiatives.projects:read` / `:write`      | Project associations                          |
| `initiatives.epics:read` / `:write`         | Epic associations                             |
| `initiatives.labels:read` / `:write`        | Labels                                        |

#### Teamspaces

| Scope                                       | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `teamspaces:read` / `:write`                | Teamspaces                                    |
| `teamspaces.projects:read` / `:write`       | Project membership                            |
| `teamspaces.members:read` / `:write`        | Member management                             |

#### Agent Runs (only if you're building an agent)

| Scope                                       | Purpose                                       |
| ------------------------------------------- | --------------------------------------------- |
| `agents.runs:read` / `:write`               | Agent runs                                    |
| `agents.run_activities:read` / `:write`     | Run activity log                              |

**A sensible default scope bundle** for a general-purpose MCP assistant covering ~90% of use cases:

```
profile:read
projects:read projects:write
projects.members:read projects.states:read projects.labels:read
projects.cycles:read projects.cycles:write
projects.modules:read projects.modules:write
projects.pages:read projects.pages:write
projects.milestones:read projects.milestones:write
projects.epics:read projects.epics:write
projects.intakes:read projects.intakes:write
projects.work_items:read projects.work_items:write
projects.work_items.comments:read projects.work_items.comments:write
projects.work_items.links:read projects.work_items.links:write
projects.work_items.relations:read projects.work_items.relations:write
projects.work_items.activities:read
projects.work_items.worklogs:read projects.work_items.worklogs:write
projects.work_item_types:read
projects.work_item_properties:read
projects.work_item_property_options:read
projects.work_item_property_values:read projects.work_item_property_values:write
workspaces.members:read workspaces.features:read
wiki.pages:read wiki.pages:write
assets:read assets:write
```

### 4.4 Choosing a mode per transport

The auth-per-transport mapping the official server uses (and you should mirror):

| Transport                | Auth resolver reads from                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| **stdio**                | `PLANE_API_KEY`, `PLANE_WORKSPACE_SLUG`, `PLANE_BASE_URL` env vars (API-Key path only)          |
| **HTTP + OAuth**         | `Authorization: Bearer <token>` header; workspace slug resolved via `/users/me/` + `/auth/o/app-installation/` |
| **HTTP + API Key (PAT)** | `X-API-Key: <token>` + `X-Workspace-Slug: <slug>` headers per request                            |
| **SSE (legacy)**         | Same as HTTP + OAuth                                                                             |

The auth resolver is a small piece; the rest of the server is transport-agnostic.

---

## 5. MCP server design

### 5.1 Server bootstrap (both transports)

Model both transports as thin wrappers around the same core:

```
core/
  auth.py          # AuthContext = { credential, workspace_slug, base_url }
  plane_client.py  # Async HTTP client, injects auth headers, retries, 429 backoff
  tools/           # One file per resource: projects.py, work_items.py, cycles.py, …
  registry.py      # Assembles all tool definitions + handlers for FastMCP
transports/
  stdio_server.py  # `plane-mcp-server stdio` entrypoint
  http_server.py   # `plane-mcp-server http` entrypoint (starlette / fastapi + FastMCP)
  oauth/
    proxy.py       # /callback, /http/auth/callback, /auth/callback endpoints
    token_store.py # Redis / Valkey / in-memory
```

Key rules:
- **Tools are pure functions** of `(auth_context, args) → dict`. No per-transport branching inside the tool.
- **Auth resolution happens in middleware** — before the tool runs, an `AuthContext` is assembled from env vars (stdio) or from request headers / OAuth token (HTTP).
- **The Plane API client is one class**, reads `auth_context` for each call.

### 5.2 Transport 1 — stdio

- Entrypoint reads config from env vars at startup:
  - `PLANE_API_KEY` — required
  - `PLANE_WORKSPACE_SLUG` — required
  - `PLANE_BASE_URL` — optional, default `https://api.plane.so`
- Speaks JSON-RPC over stdin/stdout using the MCP protocol.
- Suitable for: local dev, self-hosted Plane, Claude Desktop, IDEs.
- Distribution:
  - Python: publish to PyPI, users run via `uvx <your-package> stdio`.
  - TypeScript: publish to npm, users run via `npx @your/plane-mcp stdio`.
  - Container: publish a Docker image; users mount it via `docker run`.

### 5.3 Transport 2 — remote HTTP (streamable)

Two auth surfaces on the same server, on different paths:

| Path                     | Auth               |
| ------------------------ | ------------------ |
| `/http/mcp`              | OAuth Bearer       |
| `/http/api-key/mcp`      | `X-API-Key` + `X-Workspace-Slug` headers |
| `/sse` (optional)        | OAuth Bearer (SSE) |

Per-request auth resolver:

```
async def resolve_auth(request):
    # 1) PAT header path
    api_key = request.headers.get("x-api-key")
    slug    = request.headers.get("x-workspace-slug")
    if api_key and slug:
        # Validate by calling /users/me/
        me = await plane_get("/api/v1/users/me/", api_key=api_key)
        if not me: raise HTTPException(401)
        return AuthContext(credential=api_key, credential_type="api_key",
                           workspace_slug=slug)

    # 2) OAuth Bearer
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        # Validate by calling /users/me/
        me = await plane_get("/api/v1/users/me/", bearer=token)
        if not me: raise HTTPException(401)
        # Resolve workspace slug from the installation (bot flow)
        # or from user's workspace list (user flow).
        slug = await resolve_workspace_slug(token)
        return AuthContext(credential=token, credential_type="bearer",
                           workspace_slug=slug)

    raise HTTPException(401, "missing credentials")
```

Cache `me` and installations in Redis/Valkey with a short TTL (60s) so you don't call Plane twice per MCP request.

### 5.4 OAuth proxy responsibilities

When the MCP client hits `/http/mcp` for the first time and no valid bearer is present, respond with the MCP-spec OAuth challenge (`WWW-Authenticate` header). The client will then hit `/http/auth/authorize`, which your proxy:

1. Generates a `state` value (CSRF, stored in Redis, 5-min TTL).
2. Redirects the browser to `https://api.plane.so/auth/o/authorize-app/?client_id=…&redirect_uri=<your-mcp>/http/auth/callback&state=<state>&scope=<scopes>`.
3. Plane returns to `/http/auth/callback?code=…&state=…`.
4. Your handler:
   - Verifies `state`.
   - Exchanges `code` for `access_token` + `refresh_token`.
   - Stores tokens in Redis keyed by a bearer your server issues back to the MCP client.
5. Returns the bearer to the MCP client, which now includes it on every MCP request.

**Registered redirect URIs to allowlist in the OAuth app** (see §4.2.3):
- `<mcp_url>/callback` — generic
- `<mcp_url>/http/auth/callback` — HTTP transport
- `<mcp_url>/auth/callback` — SSE legacy

Plus the client-native URIs from §4.2.4 if you want in-client redirect for IDE integrations.

### 5.5 Identifier resolution — critical UX detail

Plane exposes work items two ways:

| Kind                    | Example                                        | Used by                              |
| ----------------------- | ---------------------------------------------- | ------------------------------------ |
| **Readable identifier** | `ENG-42` = `<project_identifier>-<seq_id>`     | Users, URLs, chat                    |
| **UUID**                | `3fa85f64-5717-4562-b3fc-2c963f66afa6`         | Every API endpoint                   |

Give the model two retrieval tools:

- `retrieve_work_item(project_id: uuid, work_item_id: uuid)` — direct UUID access
- `retrieve_work_item_by_identifier(project_identifier: str, work_item_identifier: str)` — accepts `"ENG"` + `"42"`

The `by_identifier` tool internally calls the sequence-id endpoint (`…/work-items/identifier/{project_identifier}-{sequence_id}/`) and returns the full record including the UUID, which the model can then use for updates, transitions, etc.

Same idea for projects (also have short identifiers) and workspace slugs (visible in URL).

### 5.6 Tool naming — conventions

Use one predictable verb per action across all resources:

- `list_<resource>` — collection, always paginated
- `retrieve_<resource>` — single by UUID
- `retrieve_<resource>_by_identifier` — single by human-readable ID (where supported)
- `create_<resource>` — POST
- `update_<resource>` — PATCH
- `delete_<resource>` — DELETE
- `search_<resource>` — text search (returns pointers, not full records)
- `add_<sub>_to_<resource>` / `remove_<sub>_from_<resource>` — many-to-many joins
- `archive_<resource>` / `unarchive_<resource>` — soft delete

Consistent naming = the model learns the tool taxonomy from one example.

### 5.7 Tool argument shape

- `project_id`, `workspace_slug`, and all `_id` fields: UUID strings.
- Dates: ISO `YYYY-MM-DD` for date-only fields (`start_date`, `due_date`, `target_date`); full ISO 8601 for timestamps.
- Bodies: pass rich content as `description_html` / `comment_html` (HTML-in-string). Plane stores comments and descriptions as rich text.
- Arrays: pass UUID lists as JSON arrays: `assignee_ids: [uuid, uuid]`, `label_ids: [uuid]`.
- Enums with fixed vocab: pass as string, validate server-side (see §6 for exact vocabularies).

---

## 6. MCP tool catalog — the full inventory

This mirrors the 100+ tools shipped by the official server. Group headings match the API resource groups from §3.

### 6.1 Users

| Tool     | Description                                                        |
| -------- | ------------------------------------------------------------------ |
| `get_me` | Return the authenticated user's profile. No parameters.            |

### 6.2 Workspaces

| Tool                        | Args                     | Description                                     |
| --------------------------- | ------------------------ | ----------------------------------------------- |
| `get_workspace_members`     | —                        | List all workspace members                      |
| `get_workspace_features`    | —                        | Read enabled workspace features                 |
| `update_workspace_features` | (partial features dict)  | Toggle workspace features                       |

### 6.3 Projects

| Tool                          | Required                          | Optional                                            |
| ----------------------------- | --------------------------------- | --------------------------------------------------- |
| `list_projects`               | —                                 | `cursor`, `per_page`, `fields`, `expand`            |
| `create_project`              | `name`, `identifier`              | `description`, `network` (`0`=secret, `2`=public)   |
| `retrieve_project`            | `project_id`                      | `fields`, `expand`                                  |
| `update_project`              | `project_id`                      | any project fields                                  |
| `delete_project`              | `project_id`                      | —                                                   |
| `get_project_worklog_summary` | `project_id`                      | —                                                   |
| `get_project_members`         | `project_id`                      | —                                                   |
| `get_project_features`        | `project_id`                      | —                                                   |
| `update_project_features`     | `project_id`                      | feature flags                                       |

### 6.4 Work items

| Tool                                | Required                                                    | Optional                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `list_work_items`                   | `project_id` **or** at least one filter                     | `query`, `assignee_ids[]`, `state_ids[]`, `state_groups[]`, `priorities[]`, `label_ids[]`, `type_ids[]`, `cycle_ids[]`, `module_ids[]`, `is_archived`, `created_by_ids[]`, `workspace_search`, `limit`, `cursor`, `per_page`, `expand`, `fields`, `order_by` |
| `create_work_item`                  | `project_id`, `name`                                        | `description_html`, `state_id`, `priority`, `assignee_ids[]`, `label_ids[]`, `type_id`, `parent_id`, `start_date`, `due_date`, `estimate_point`, `external_source`, `external_id` |
| `retrieve_work_item`                | `project_id`, `work_item_id`                                | `fields`, `expand`                                                                                             |
| `retrieve_work_item_by_identifier`  | `project_identifier` (e.g., `ENG`), `work_item_identifier` (e.g., `42`) | —                                                                                             |
| `update_work_item`                  | `project_id`, `work_item_id`                                | any updatable field                                                                                            |
| `delete_work_item`                  | `project_id`, `work_item_id`                                | —                                                                                                              |
| `search_work_items`                 | `project_id`, `query`                                       | —                                                                                                              |

**Vocabularies:**
- `priority` ∈ {`urgent`, `high`, `medium`, `low`, `none`}
- `state_groups` ∈ {`backlog`, `unstarted`, `started`, `completed`, `cancelled`}

### 6.5 Work item activities

| Tool                          | Required                                    |
| ----------------------------- | ------------------------------------------- |
| `list_work_item_activities`   | `project_id`, `work_item_id`                |
| `retrieve_work_item_activity` | `project_id`, `work_item_id`, `activity_id` |

### 6.6 Work item comments

| Tool                          | Required                                                     |
| ----------------------------- | ------------------------------------------------------------ |
| `list_work_item_comments`     | `project_id`, `work_item_id`                                 |
| `retrieve_work_item_comment`  | `project_id`, `work_item_id`, `comment_id`                   |
| `create_work_item_comment`    | `project_id`, `work_item_id`, `comment_html`                 |
| `update_work_item_comment`    | `project_id`, `work_item_id`, `comment_id`, `comment_html`   |
| `delete_work_item_comment`    | `project_id`, `work_item_id`, `comment_id`                   |

### 6.7 Work item links

| Tool                        | Required                                                      |
| --------------------------- | ------------------------------------------------------------- |
| `list_work_item_links`      | `project_id`, `work_item_id`                                  |
| `retrieve_work_item_link`   | `project_id`, `work_item_id`, `link_id`                       |
| `create_work_item_link`     | `project_id`, `work_item_id`, `url` (+ optional `title`)      |
| `update_work_item_link`     | `project_id`, `work_item_id`, `link_id`, `url` / `title`      |
| `delete_work_item_link`     | `project_id`, `work_item_id`, `link_id`                       |

### 6.8 Work item relations

`relation_type` ∈ {`blocking`, `blocked_by`, `duplicate_of`, `duplicate`, `relates_to`}.

| Tool                         | Required                                                              |
| ---------------------------- | --------------------------------------------------------------------- |
| `list_work_item_relations`   | `project_id`, `work_item_id`                                          |
| `create_work_item_relation`  | `project_id`, `work_item_id`, `related_work_item_id`, `relation_type` |
| `remove_work_item_relation`  | `project_id`, `work_item_id`, `relation_id`                           |

### 6.9 Work item properties (custom fields)

| Tool                          | Required                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| `list_work_item_properties`   | `project_id`                                                      |
| `create_work_item_property`   | `project_id`, `name`, `property_type`                             |
| `retrieve_work_item_property` | `project_id`, `property_id`                                       |
| `update_work_item_property`   | `project_id`, `property_id` (+ patch fields)                      |
| `delete_work_item_property`   | `project_id`, `property_id`                                       |

### 6.10 Work item types

| Tool                     | Required                                             |
| ------------------------ | ---------------------------------------------------- |
| `list_work_item_types`   | `project_id`                                         |
| `create_work_item_type`  | `project_id`, `name` (+ optional `description`, `is_active`) |
| `retrieve_work_item_type`| `project_id`, `type_id`                              |
| `update_work_item_type`  | `project_id`, `type_id` (+ patch)                    |
| `delete_work_item_type`  | `project_id`, `type_id`                              |

### 6.11 Worklogs (time tracking, minutes)

| Tool             | Required                                                              |
| ---------------- | --------------------------------------------------------------------- |
| `list_work_logs` | `project_id`, `work_item_id`                                          |
| `create_work_log`| `project_id`, `work_item_id`, `duration` (int, minutes) (+ `description`) |
| `update_work_log`| `project_id`, `work_item_id`, `work_log_id` (+ patch)                 |
| `delete_work_log`| `project_id`, `work_item_id`, `work_log_id`                           |

### 6.12 States

Create/update fields: `name`, `color` (`#RRGGBB`), `group` (see vocab), optional `description`.

| Tool             | Required                                    |
| ---------------- | ------------------------------------------- |
| `list_states`    | `project_id`                                |
| `create_state`   | `project_id`, `name`, `color`, `group`      |
| `retrieve_state` | `project_id`, `state_id`                    |
| `update_state`   | `project_id`, `state_id` (+ patch)          |
| `delete_state`   | `project_id`, `state_id`                    |

### 6.13 Labels

Create fields: `name`, `color`, optional `parent`.

| Tool             | Required                                    |
| ---------------- | ------------------------------------------- |
| `list_labels`    | `project_id`                                |
| `create_label`   | `project_id`, `name`, `color`               |
| `retrieve_label` | `project_id`, `label_id`                    |
| `update_label`   | `project_id`, `label_id` (+ patch)          |
| `delete_label`   | `project_id`, `label_id`                    |

### 6.14 Cycles (sprints)

| Tool                            | Required                                                          |
| ------------------------------- | ----------------------------------------------------------------- |
| `list_cycles`                   | `project_id`                                                      |
| `list_archived_cycles`          | `project_id`                                                      |
| `create_cycle`                  | `project_id`, `name` (+ `start_date`, `end_date`, `description`)  |
| `retrieve_cycle`                | `project_id`, `cycle_id`                                          |
| `update_cycle`                  | `project_id`, `cycle_id` (+ patch)                                |
| `delete_cycle`                  | `project_id`, `cycle_id`                                          |
| `archive_cycle`                 | `project_id`, `cycle_id`                                          |
| `unarchive_cycle`               | `project_id`, `cycle_id`                                          |
| `list_cycle_work_items`         | `project_id`, `cycle_id`                                          |
| `add_work_items_to_cycle`       | `project_id`, `cycle_id`, `work_item_ids[]`                       |
| `remove_work_item_from_cycle`   | `project_id`, `cycle_id`, `work_item_id`                          |
| `transfer_cycle_work_items`     | `project_id`, `cycle_id` (source), `new_cycle_id` (target)        |

### 6.15 Modules

| Tool                             | Required                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| `list_modules`                   | `project_id`                                                         |
| `list_archived_modules`          | `project_id`                                                         |
| `create_module`                  | `project_id`, `name` (+ `description`, `start_date`, `target_date`, `lead`, `members[]`) |
| `retrieve_module`                | `project_id`, `module_id`                                            |
| `update_module`                  | `project_id`, `module_id` (+ patch)                                  |
| `delete_module`                  | `project_id`, `module_id`                                            |
| `archive_module`                 | `project_id`, `module_id`                                            |
| `unarchive_module`               | `project_id`, `module_id`                                            |
| `list_module_work_items`         | `project_id`, `module_id`                                            |
| `add_work_items_to_module`       | `project_id`, `module_id`, `work_item_ids[]`                         |
| `remove_work_item_from_module`   | `project_id`, `module_id`, `work_item_id`                            |

### 6.16 Epics

Epics are a specialised work-item type. The MCP layer should transparently resolve the Epic type UUID and use the epics endpoints.

| Tool             | Required                                    |
| ---------------- | ------------------------------------------- |
| `list_epics`     | `project_id`                                |
| `create_epic`    | `project_id`, `name` (+ description, etc.)  |
| `retrieve_epic`  | `project_id`, `epic_id`                     |
| `update_epic`    | `project_id`, `epic_id` (+ patch)           |
| `delete_epic`    | `project_id`, `epic_id`                     |

Also expose work-item join tools (`add_epic_work_items`, `list_epic_work_items`) which map to `/api/v1/workspaces/{slug}/projects/{pid}/epics/{eid}/work-items/`.

### 6.17 Milestones

| Tool                               | Required                                                       |
| ---------------------------------- | -------------------------------------------------------------- |
| `list_milestones`                  | `project_id`                                                   |
| `create_milestone`                 | `project_id`, `name` (+ dates, description)                    |
| `retrieve_milestone`               | `project_id`, `milestone_id`                                   |
| `update_milestone`                 | `project_id`, `milestone_id`                                   |
| `delete_milestone`                 | `project_id`, `milestone_id`                                   |
| `list_milestone_work_items`        | `project_id`, `milestone_id`                                   |
| `add_work_items_to_milestone`      | `project_id`, `milestone_id`, `work_item_ids[]`                |
| `remove_work_items_from_milestone` | `project_id`, `milestone_id`, `work_item_ids[]`                |

### 6.18 Initiatives (workspace-scoped)

| Tool                    | Required                                    |
| ----------------------- | ------------------------------------------- |
| `list_initiatives`      | —                                           |
| `create_initiative`     | `name` (+ dates, lead, description)         |
| `retrieve_initiative`   | `initiative_id`                             |
| `update_initiative`     | `initiative_id`                             |
| `delete_initiative`     | `initiative_id`                             |

Plus sub-resource tools: `list_initiative_projects` / `add_projects_to_initiative` / `remove_projects_from_initiative`; same for epics; and label CRUD.

### 6.19 Intake

| Tool                          | Required                                                           |
| ----------------------------- | ------------------------------------------------------------------ |
| `list_intake_work_items`      | `project_id`                                                       |
| `create_intake_work_item`     | `project_id`, `name` (+ `description_html`)                        |
| `retrieve_intake_work_item`   | `project_id`, `work_item_id`                                       |
| `update_intake_work_item`     | `project_id`, `work_item_id`                                       |
| `delete_intake_work_item`     | `project_id`, `work_item_id`                                       |

### 6.20 Pages

| Tool                       | Required                                                     |
| -------------------------- | ------------------------------------------------------------ |
| `retrieve_workspace_page`  | `page_id`                                                    |
| `retrieve_project_page`    | `project_id`, `page_id`                                      |
| `create_workspace_page`    | `name` (+ `description_html`)                                |
| `create_project_page`      | `project_id`, `name` (+ `description_html`)                  |

---

## 7. Key data-model schemas

The exact wire-level shape of the main entities, as returned by the API. Use these to build typed models (Pydantic/Zod/etc.) in your MCP server.

### 7.1 Work item (issue)

```json
{
  "id": "775c5716-5302-4617-bb9f-2cd843911268",
  "name": "webhook test 3",
  "sequence_id": 3,
  "description_html": "<p>…</p>",
  "description_stripped": "…",
  "description_json": {},

  "priority": "none",            // urgent | high | medium | low | none
  "state_id": "067b88e5-…",
  "type_id": null,
  "estimate_point_id": null,
  "point": null,

  "parent_id": null,
  "project_id": "59e3be42-…",
  "workspace_id": "b54ecb0d-…",

  "assignee_ids": [],
  "label_ids": [],

  "start_date": null,
  "target_date": null,           // == due_date on writes
  "completed_at": null,

  "sort_order": 75535,
  "is_draft": false,

  "external_source": null,
  "external_id": null,

  "created_at": "2026-03-31T11:44:41.249292+00:00",
  "updated_at": "2026-03-31T11:44:41.249304+00:00",
  "last_activity_at": "2026-03-31T11:44:41.346305+00:00",
  "archived_at": null,
  "deleted_at": null,

  "created_by_id": "754009ab-…",
  "updated_by_id": null
}
```

**Create-work-item body** (POST):

```json
{
  "name": "Login times out on Safari",
  "description_html": "<p>OAuth callback…</p>",
  "priority": "high",
  "state": "550e8400-e29b-41d4-a716-446655440000",
  "assignees": ["550e8400-…"],
  "labels": ["550e8400-…"],
  "type_id": "…",
  "parent": null,
  "start_date": "2026-06-01",
  "target_date": "2026-06-15",
  "estimate_point": "…",
  "external_id": null,
  "external_source": null
}
```

Note: on the write side the field name for assignees is `assignees` and state is `state` — but on the read side they come back as `assignee_ids` and `state_id`. This asymmetry is real and worth explicitly normalising in your MCP layer.

### 7.2 Project

```json
{
  "id": "59e3be42-…",
  "name": "Engineering",
  "identifier": "ENG",       // used in ENG-42 style work item IDs
  "description": "…",
  "network": 2,              // 0 secret, 2 public
  "workspace": "b54ecb0d-…",
  "workspace_slug": "acme",
  "created_at": "…",
  "updated_at": "…",
  "created_by": "…",
  "default_assignee": null,
  "project_lead": "…",
  "estimate": null,          // estimate scheme UUID
  "module_view": true,
  "cycle_view": true,
  "issue_views_view": true,
  "page_view": true,
  "inbox_view": false,
  "cover_image": null,
  "archive_in": 0,
  "close_in": 0,
  "default_state": null
}
```

### 7.3 Cycle

```json
{
  "id": "…",
  "name": "Sprint 15",
  "description": "…",
  "start_date": "2025-06-02",
  "end_date": "2025-06-15",
  "owned_by": "…",
  "project_id": "…",
  "workspace_id": "…",
  "sort_order": 65535,
  "view_props": {},
  "progress_snapshot": null,
  "created_at": "…",
  "updated_at": "…"
}
```

### 7.4 State

```json
{
  "id": "…",
  "name": "In Progress",
  "color": "#F59E0B",
  "group": "started",        // backlog | unstarted | started | completed | cancelled
  "sequence": 30000,
  "default": false,
  "description": "",
  "project_id": "…",
  "workspace_id": "…"
}
```

### 7.5 Label

```json
{
  "id": "…",
  "name": "bug",
  "color": "#FF0000",
  "parent": null,
  "project_id": "…",
  "workspace_id": "…"
}
```

### 7.6 Comment

```json
{
  "id": "4797f841-…",
  "issue_id": "088a83b9-…",
  "actor_id": "88fc36c8-…",
  "comment_html": "<p>Fixed in commit abc123</p>",
  "comment_stripped": "Fixed in commit abc123",
  "access": "INTERNAL",        // INTERNAL or EXTERNAL
  "edited_at": null,
  "created_at": "…",
  "updated_at": "…"
}
```

### 7.7 Link

```json
{
  "id": "a6f8e562-…",
  "url": "https://figma.com/…",
  "title": "Design mockup",
  "issue_id": "…",
  "project_id": "…",
  "workspace_id": "…",
  "created_by_id": "…",
  "created_at": "…"
}
```

### 7.8 Worklog

```json
{
  "id": "…",
  "issue_id": "…",
  "project_id": "…",
  "workspace_id": "…",
  "duration": 90,              // minutes
  "description": "Implemented retry logic",
  "logged_by": "…",
  "created_at": "…",
  "updated_at": "…"
}
```

### 7.9 Pagination envelope (all list endpoints)

```json
{
  "next_cursor": "20:2:0",
  "prev_cursor": "20:0:1",
  "next_page_results": true,
  "prev_page_results": true,
  "count": 20,
  "total_pages": 50,
  "total_results": 1000,
  "extra_stats": {},
  "results": [ /* array of the resource */ ]
}
```

---

## 8. Webhooks — for reactive/agent workflows

If your MCP tool also reacts to Plane events (e.g. an agent that comments on new bugs), consume Plane webhooks alongside the MCP server. Webhooks are workspace-scoped; only Workspace Owner/Admin can create them.

### 8.1 Registering a webhook

*Workspace Settings → Webhooks → Add webhook.* Set:
- **Payload URL** — public HTTPS endpoint.
- **Events** — pick from the list in §8.2.
- **Filters** (optional) — PQL expression to only fire on matching work items.

Plane generates and downloads (once) an HMAC secret starting with `plane_wh_`. Save it — you can regenerate but not view later.

### 8.2 Available events (all v2, dot-notation)

| Group                    | Events                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| Projects                 | `project.created` `.updated` `.archived` `.deleted`                    |
| Cycles                   | `cycle.created` `.updated` `.archived` `.deleted`                      |
| Modules                  | `module.created` `.updated` `.archived` `.deleted`                     |
| Milestones               | `milestone.created` `.updated` `.deleted`                              |
| Pages                    | `page.created` `.updated` `.archived` `.deleted`                       |
| Page comments            | `page.comment.created` `.updated` `.deleted`                           |
| Work items               | `workitem.created` `.updated` `.archived` `.deleted`                   |
| Work item comments       | `workitem.comment.created` `.updated` `.deleted`                       |
| Work item links          | `workitem.link.created` `.updated` `.deleted`                          |
| Work item votes          | `workitem.vote.created` `.deleted`                                     |
| Work item attachments    | `workitem.attachment.created` `.updated` `.deleted`                    |
| Work item relations      | `workitem.relation.created` `.deleted`                                 |
| Work item dependencies   | `workitem.dependency.created` `.deleted`                               |
| Work item page links     | `workitem.page_link.created` `.deleted`                                |

### 8.3 Filtering (PQL)

Work item events can be filtered:

```
priority = "urgent"
priority in ["urgent", "high"]
state_group = "started"
assignee_id = "<user-uuid>"
project_id = "<project-uuid>"
```

Available fields: `type_id`, `state_group`, `assignee_id`, `label_id`, `project_id`, `priority`, `start_date`, `target_date`.

### 8.4 Request headers Plane sends

| Header              | Value                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| `Content-Type`      | `application/json`                                                           |
| `User-Agent`        | `Autopilot`                                                                  |
| `X-Plane-Delivery`  | Unique per delivery attempt (retries get new IDs; matches `delivery_id` in body) |
| `X-Plane-Event`     | Event name, e.g. `workitem.created` (matches `event` in body)                |
| `X-Plane-Signature` | HMAC-SHA256 of raw body with your secret                                     |

### 8.5 Payload envelope

```json
{
  "version": "v2",
  "delivery_id": "<uuid>",     // new per retry
  "event_id": "<uuid>",        // stable across retries — use for dedup
  "entity_id": "<uuid>",
  "entity_type": "issue",       // or cycle, issue_comment, issue_link, …
  "event": "workitem.updated",
  "webhook_id": "<uuid>",
  "workspace_id": "<uuid>",
  "data": { /* full entity — empty {} for deletes */ },
  "previous_attributes": {
    /* on updated: previous values of changed fields */
    /* on deleted: full pre-delete record */
    /* otherwise: {} */
  }
}
```

### 8.6 Verifying the signature (Python)

```python
import hashlib, hmac

def verify(raw_body: bytes, secret: str, header_sig: str) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header_sig)
```

**Use the raw bytes of the incoming request.** Re-serialising JSON breaks the signature.

### 8.7 Delivery + retries

- Async delivery.
- Any `2xx` = success.
- Retry policy: exponential backoff with ~10-min base + jitter, **5 attempts**. After exhaustion the webhook is auto-disabled and Plane emails the creator.
- `4xx` responses are not retried.
- No manual retry option.

### 8.8 Dedup

Use `event_id` (stable across retries) as the idempotency key. Store recent event IDs for ~1 hour in Redis; skip repeats.

---

## 9. Reference implementation guide

### 9.1 Recommended stack

- **Python** if you want to reuse patterns from the official server (which uses `FastMCP` + `httpx` + Pydantic). Ecosystem is mature; `uvx` distribution is one command.
- **TypeScript** if your team is JS-heavy or you want browser-side tooling. Use `@modelcontextprotocol/sdk` + `zod` + `undici`. Ship via npm.

Storage:
- **Redis / Valkey** for token cache, OAuth state, dedup — small footprint, official server uses it.

### 9.2 Minimal directory layout (Python + FastMCP)

```
plane_mcp/
├── __init__.py
├── __main__.py              # CLI: `plane-mcp-server stdio` or `http`
├── config.py                # Env vars, base URL, defaults
├── auth/
│   ├── __init__.py
│   ├── context.py           # AuthContext dataclass
│   ├── env.py               # stdio: read PLANE_API_KEY, PLANE_WORKSPACE_SLUG
│   ├── header.py            # HTTP-PAT: read x-api-key + x-workspace-slug
│   └── oauth.py             # HTTP-OAuth: bearer validation, workspace resolution
├── client/
│   ├── __init__.py
│   ├── client.py            # PlaneClient — async httpx wrapper
│   ├── retries.py           # 429/5xx retry with backoff
│   └── errors.py            # Typed errors surfaced to MCP
├── tools/
│   ├── __init__.py          # Registers every tool with FastMCP
│   ├── projects.py
│   ├── work_items.py
│   ├── cycles.py
│   ├── modules.py
│   ├── ...                  # One file per resource group
├── models/
│   └── ...                  # Pydantic models per §7
└── transports/
    ├── stdio.py             # FastMCP.run_stdio()
    └── http.py              # Starlette + FastMCP.streamable_http_app + OAuth proxy
```

### 9.3 CLI entrypoint pattern

```
plane-mcp-server stdio    # Reads env, runs stdio
plane-mcp-server http     # Reads env, binds 0.0.0.0:8211, serves both /http/mcp and /http/api-key/mcp
```

### 9.4 Auth resolver (per-request)

```python
async def resolve_auth_context(headers, env) -> AuthContext:
    # 1) PAT (HTTP path)
    api_key = headers.get("x-api-key")
    slug    = headers.get("x-workspace-slug")
    if api_key and slug:
        await _validate_api_key(api_key)  # GET /users/me/
        return AuthContext(api_key=api_key, workspace_slug=slug,
                           base_url=env.PLANE_BASE_URL)

    # 2) OAuth Bearer (HTTP path)
    auth = headers.get("authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        me    = await _validate_bearer(token)
        slug  = await _resolve_workspace_slug(token, me)
        return AuthContext(bearer=token, workspace_slug=slug,
                           base_url=env.PLANE_BASE_URL)

    # 3) Env (stdio path)
    if env.PLANE_API_KEY and env.PLANE_WORKSPACE_SLUG:
        return AuthContext(api_key=env.PLANE_API_KEY,
                           workspace_slug=env.PLANE_WORKSPACE_SLUG,
                           base_url=env.PLANE_BASE_URL)

    raise Unauthorized("No valid credentials in headers or env")
```

### 9.5 Plane API client

```python
class PlaneClient:
    def __init__(self, auth: AuthContext):
        self.base    = auth.base_url
        self.slug    = auth.workspace_slug
        headers      = {}
        if auth.api_key:
            headers["X-API-Key"] = auth.api_key
        else:
            headers["Authorization"] = f"Bearer {auth.bearer}"
        self.http = httpx.AsyncClient(base_url=self.base, headers=headers, timeout=30)

    async def get(self, path: str, **params):     return await self._req("GET", path, params=params)
    async def post(self, path: str, json):        return await self._req("POST", path, json=json)
    async def patch(self, path: str, json):       return await self._req("PATCH", path, json=json)
    async def delete(self, path: str):            return await self._req("DELETE", path)

    def ws(self, sub: str) -> str:
        # Prepends /api/v1/workspaces/{slug}/
        return f"/api/v1/workspaces/{self.slug}/{sub.lstrip('/')}"

    async def _req(self, method, path, *, json=None, params=None, attempt=0):
        r = await self.http.request(method, path, json=json, params=params)
        if r.status_code == 429 and attempt < 3:
            reset = int(r.headers.get("X-RateLimit-Reset", "0"))
            wait  = max(1, reset - int(time.time()))
            await asyncio.sleep(min(wait, 30))
            return await self._req(method, path, json=json, params=params, attempt=attempt+1)
        if r.status_code >= 400:
            raise PlaneError(r.status_code, r.text)
        return r.json() if r.content else None
```

### 9.6 Example tool implementation

```python
@mcp.tool()
async def create_work_item(
    project_id: str,
    name: str,
    description_html: str | None = None,
    state_id: str | None = None,
    priority: Literal["urgent","high","medium","low","none"] | None = None,
    assignee_ids: list[str] | None = None,
    label_ids: list[str] | None = None,
    type_id: str | None = None,
    parent_id: str | None = None,
    start_date: str | None = None,
    due_date: str | None = None,
) -> dict:
    """Create a new work item in a Plane project. Returns the created work item."""
    client = await get_client()  # AuthContext-scoped
    body = {
        "name": name,
        **({"description_html": description_html} if description_html else {}),
        **({"state": state_id} if state_id else {}),
        **({"priority": priority} if priority else {}),
        **({"assignees": assignee_ids} if assignee_ids else {}),
        **({"labels": label_ids} if label_ids else {}),
        **({"type_id": type_id} if type_id else {}),
        **({"parent": parent_id} if parent_id else {}),
        **({"start_date": start_date} if start_date else {}),
        **({"target_date": due_date} if due_date else {}),
    }
    return await client.post(client.ws(f"projects/{project_id}/work-items/"), json=body)
```

Note the field-name normalization (`state_id` → `state`, `assignee_ids` → `assignees`, `due_date` → `target_date`) that the MCP layer does for the model — see §7.1 for why.

---

## 10. Common MCP workflows (what the tools should compose to)

These are the workflows any LLM using your MCP should be able to accomplish in 2–4 tool calls.

### Look up by human-readable ID

Prompt: *"What's ENG-42 about?"*
Flow: `retrieve_work_item_by_identifier(project_identifier="ENG", work_item_identifier="42")`

### Create a triaged bug

Prompt: *"Create a high-priority bug in ENG called 'Login times out on Safari' and assign it to me."*
Flow:
1. `get_me()` → grab user UUID
2. `list_projects()` (or cache) → resolve `ENG` → `project_id`
3. `create_work_item(project_id, name="Login times out on Safari", priority="high", assignee_ids=[<me>])`

### Move a work item to Done + comment

Prompt: *"Mark ENG-88 as done. Comment: 'Fixed in commit abc123.'"*
Flow:
1. `retrieve_work_item_by_identifier("ENG", "88")` → UUID
2. `list_states(project_id)` → find state with `group="completed"`
3. `update_work_item(project_id, work_item_id, state_id=<done>)`
4. `create_work_item_comment(project_id, work_item_id, comment_html="<p>Fixed in commit abc123.</p>")`

### Sprint planning

Prompt: *"Create 'Sprint 15' in ENG from Jun 2 to Jun 15, and move all incomplete Sprint 14 issues into it."*
Flow:
1. `create_cycle(project_id, name="Sprint 15", start_date="2025-06-02", end_date="2025-06-15")`
2. `list_cycles(project_id)` → find Sprint 14's UUID
3. `transfer_cycle_work_items(project_id, cycle_id=<sprint14>, new_cycle_id=<sprint15>)`

### Cross-project search

Prompt: *"Show me all high-priority bugs assigned to me still in progress."*
Flow:
1. `get_me()` → user UUID
2. `list_work_items(priorities=["high"], state_groups=["started"], assignee_ids=[<me>], workspace_search=true)`

### Log time

Prompt: *"Log 90 min on ENG-42: 'Implemented retry logic.'"*
Flow:
1. `retrieve_work_item_by_identifier("ENG","42")` → UUID
2. `create_work_log(project_id, work_item_id, duration=90, description="Implemented retry logic")`

### Add to a module

Prompt: *"Add ENG-55, ENG-56, ENG-57 to the 'Checkout Redesign' module."*
Flow:
1. Resolve all three via `retrieve_work_item_by_identifier` (3 calls)
2. `list_modules(project_id)` → find `Checkout Redesign` UUID
3. `add_work_items_to_module(project_id, module_id, work_item_ids=[...])`

---

## 11. Deployment

### 11.1 Stdio distribution

**Python (PyPI):**
```toml
# pyproject.toml
[project]
name = "your-plane-mcp"
version = "0.1.0"
dependencies = ["fastmcp", "httpx", "pydantic"]

[project.scripts]
your-plane-mcp = "your_plane_mcp.__main__:main"
```

Users install and run via `uvx your-plane-mcp stdio`.

**TypeScript (npm):**
```json
{
  "name": "@your/plane-mcp",
  "bin": { "your-plane-mcp": "./dist/index.js" }
}
```

Users run via `npx @your/plane-mcp stdio`.

### 11.2 Remote HTTP — Docker Compose

Based on the pattern from the official server:

```yaml
name: your-plane-mcp
services:
  mcp:
    image: your/plane-mcp-server:latest
    restart: always
    ports:
      - "8211:8211"
    env_file: variables.env
    environment:
      REDIS_HOST: valkey
      REDIS_PORT: "6379"
    depends_on:
      valkey: { condition: service_healthy }

  valkey:
    image: valkey/valkey:8-alpine
    restart: always
    volumes:
      - valkey-data:/data
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  valkey-data:
```

`variables.env`:
```
PLANE_BASE_URL=https://api.plane.so
PLANE_OAUTH_PROVIDER_CLIENT_ID=your-client-id
PLANE_OAUTH_PROVIDER_CLIENT_SECRET=your-client-secret
PLANE_OAUTH_PROVIDER_BASE_URL=https://mcp.yourdomain.com
# Optional: separate internal URL for server-to-server calls
# PLANE_INTERNAL_BASE_URL=http://plane-api.internal
```

Front the container with a TLS-terminating reverse proxy (nginx / Caddy / Traefik / Cloudflare). OAuth callbacks require `https://`.

**Environment variable reference:**

| Var                                  | Required | Description                                                                    |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------ |
| `PLANE_BASE_URL`                     | No       | Plane API URL. Default `https://api.plane.so`.                                 |
| `PLANE_INTERNAL_BASE_URL`            | No       | Alternate URL for server-to-server calls (private networks). Falls back to `PLANE_BASE_URL`. |
| `PLANE_OAUTH_PROVIDER_CLIENT_ID`     | Yes      | From your OAuth app registration.                                              |
| `PLANE_OAUTH_PROVIDER_CLIENT_SECRET` | Yes      | Same.                                                                          |
| `PLANE_OAUTH_PROVIDER_BASE_URL`      | Yes      | Public URL of **this MCP server** — used to build redirect URIs.               |
| `MCP_PATH_PREFIX`                    | No       | Path prefix if reverse-proxying alongside other apps.                          |
| `REDIS_HOST` / `REDIS_PORT`          | No       | Redis/Valkey for token cache. Omit → in-memory (lost on restart).              |

### 11.3 Remote HTTP — Kubernetes / Helm

If you want to publish a Helm chart, model it after Plane's:

```yaml
# values.yaml
ingress:
  enabled: true
  host: mcp.yourdomain.com
  ingressClass: nginx
  ssl:
    enabled: true
    issuer: cloudflare
    email: you@yourdomain.com

services:
  api:
    replicas: 2
    plane_base_url: "https://api.plane.so"
    plane_oauth:
      enabled: true
      client_id: "<...>"
      client_secret: "<...>"
      provider_base_url: "https://mcp.yourdomain.com"
  redis:
    local_setup: true   # or set external_redis_url
```

### 11.4 Sanity check

```bash
# From your MCP host, reach Plane:
curl -H "x-api-key: $PLANE_API_KEY" "$PLANE_BASE_URL/api/v1/users/me/"

# From the outside, hit the MCP endpoint (should return 401 or MCP handshake):
curl https://mcp.yourdomain.com/http/mcp
```

---

## 12. Client configuration recipes

These match Plane's official server; users of your fork should be able to substitute your URL 1:1.

### Claude Desktop — stdio

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "plane": {
      "command": "uvx",
      "args": ["your-plane-mcp", "stdio"],
      "env": {
        "PLANE_API_KEY": "your_api_key_here",
        "PLANE_WORKSPACE_SLUG": "your-workspace-slug",
        "PLANE_BASE_URL": "https://api.plane.so"
      }
    }
  }
}
```

### Claude Desktop — remote OAuth via mcp-remote

Claude Desktop doesn't speak remote HTTP natively — use the `mcp-remote` bridge.

```json
{
  "mcpServers": {
    "plane": {
      "command": "npx",
      "args": ["mcp-remote@latest", "https://mcp.yourdomain.com/http/mcp"]
    }
  }
}
```

### Claude Desktop — remote PAT

```json
{
  "mcpServers": {
    "plane": {
      "url": "https://mcp.yourdomain.com/http/api-key/mcp",
      "type": "http",
      "headers": {
        "x-api-key": "your_api_key_here",
        "x-workspace-slug": "your-workspace-slug"
      }
    }
  }
}
```

### Claude Code CLI

```bash
# Stdio
claude mcp add plane \
  -e PLANE_API_KEY=your_api_key_here \
  -e PLANE_WORKSPACE_SLUG=your-workspace-slug \
  -- uvx your-plane-mcp stdio

# Remote HTTP + OAuth
claude mcp add --transport http plane https://mcp.yourdomain.com/http/mcp

# Remote HTTP + PAT
claude mcp add-json plane '{
  "type": "http",
  "url": "https://mcp.yourdomain.com/http/api-key/mcp",
  "headers": {
    "x-api-key": "your_api_key_here",
    "x-workspace-slug": "your-workspace-slug"
  }
}'
```

### Claude.ai (Pro/Max/Team/Enterprise)

Web UI can't spawn processes — remote HTTP only.
1. *Customize → Connectors → Add custom connector.*
2. URL: `https://mcp.yourdomain.com/http/mcp` (OAuth).

### Cursor — `~/.cursor/mcp.json`

Stdio:
```json
{
  "mcpServers": {
    "plane": {
      "command": "uvx",
      "args": ["your-plane-mcp", "stdio"],
      "env": {
        "PLANE_API_KEY": "…",
        "PLANE_WORKSPACE_SLUG": "…"
      }
    }
  }
}
```

HTTP + OAuth (Cursor registers `cursor://` natively):
```json
{ "mcpServers": { "plane": { "url": "https://mcp.yourdomain.com/http/mcp", "type": "http" } } }
```

### VS Code — `.vscode/mcp.json`

```json
{
  "servers": {
    "plane": {
      "url": "https://mcp.yourdomain.com/http/mcp",
      "type": "http"
    }
  }
}
```

### Windsurf — `~/.codeium/windsurf/mcp_config.json`

Note: Windsurf uses `serverUrl`, not `url`.

```json
{
  "mcpServers": {
    "plane": {
      "serverUrl": "https://mcp.yourdomain.com/http/mcp"
    }
  }
}
```

### Zed — `~/.config/zed/settings.json`

```json
{
  "context_servers": {
    "plane-mcp-server": {
      "url": "https://mcp.yourdomain.com/http/mcp",
      "settings": {}
    }
  }
}
```

Zed's stdio format is quirky — `command` becomes an object `{ path, args, env }`.

---

## 13. Troubleshooting matrix

| Symptom                                         | HTTP status | Cause                                             | Fix                                                              |
| ----------------------------------------------- | ----------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| All tools fail immediately                      | 401         | Missing/invalid API key                           | Regenerate in Plane; re-set env or headers                       |
| Some tools fail, others work                    | 403         | Insufficient OAuth scope or workspace role        | Add scope; check user role in workspace/project                  |
| "Workspace not found"                           | 404         | Wrong `PLANE_WORKSPACE_SLUG` / `x-workspace-slug` | Take slug straight from Plane URL                                |
| Sporadic failures under load                    | 429         | Rate limit (60/min)                               | Backoff via `X-RateLimit-Reset`; batch operations where possible |
| OAuth redirect loops                            | —           | Redirect URI not registered in OAuth app          | Register all three: `/callback`, `/http/auth/callback`, `/auth/callback` |
| OAuth "invalid client"                          | 400         | Wrong `PLANE_OAUTH_PROVIDER_CLIENT_ID`/`SECRET`   | Re-copy from OAuth app in Plane                                  |
| OAuth callback but wrong domain                 | —           | `PLANE_OAUTH_PROVIDER_BASE_URL` is Plane's URL, not the MCP server's | Set to your MCP server's public HTTPS URL          |
| Tokens lost across restarts                     | —           | Redis/Valkey not configured                       | Set `REDIS_HOST`/`REDIS_PORT`                                    |
| Cannot fetch full description                   | —           | Not requesting expansion                          | Add `expand=description_html` or use retrieve endpoint           |
| Claude Desktop can't reach remote               | —           | Doesn't natively support `"type": "http"`         | Use `npx mcp-remote@latest <url>` bridge                         |
| Config file ignored                             | —           | JSON syntax error / trailing comma                | Validate JSON                                                    |
| Signature verification failing (webhooks)       | —           | JSON re-serialized before HMAC                    | Compute HMAC over **raw request bytes**                          |

---

## 14. Security checklist

- [ ] Never log or return `X-API-Key`, `Authorization`, `Client Secret`, or refresh tokens.
- [ ] Store OAuth tokens in Redis/Valkey with TTL, not on disk.
- [ ] All OAuth redirect URIs registered are `https://`.
- [ ] `state` param is generated with a CSPRNG, single-use, 5-min TTL.
- [ ] Verify `state` on OAuth callback; reject mismatches.
- [ ] Constant-time compare for webhook signature verification.
- [ ] Compute HMAC over the raw request body — do not re-serialize.
- [ ] Rate-limit your own MCP endpoints (per-token and per-IP) so a compromised token can't burn Plane's 60/min quota.
- [ ] Handle 429 with backoff — don't retry immediately.
- [ ] Refresh OAuth tokens *before* they expire (e.g., at 80% of TTL), not on 401.
- [ ] Document required scopes in your consent screen — don't request write scopes for a read-only tool.
- [ ] For self-hosted Plane, verify TLS cert chain in outbound requests; don't disable cert validation.

---

## 15. References

**Plane repos**
- Plane monorepo: <https://github.com/makeplane/plane>
- Official Plane MCP server (Python + FastMCP, MIT): <https://github.com/makeplane/plane-mcp-server>

**Developer docs**
- Landing: <https://developers.plane.so/>
- API reference: <https://developers.plane.so/api-reference/introduction>
- Build a Plane app (OAuth): <https://developers.plane.so/dev-tools/build-plane-app/overview>
- Choose token flow: <https://developers.plane.so/dev-tools/build-plane-app/choose-token-flow>
- OAuth scopes reference: <https://developers.plane.so/dev-tools/build-plane-app/oauth-scopes>
- MCP server user guide: <https://developers.plane.so/dev-tools/mcp-server>
- MCP self-host: <https://developers.plane.so/dev-tools/mcp-server-self-host>
- MCP tool reference: <https://developers.plane.so/dev-tools/mcp-server-tools>
- Webhooks: <https://developers.plane.so/dev-tools/intro-webhooks>
- OpenAPI spec generator: <https://developers.plane.so/dev-tools/openapi-specification>

**Standards**
- Model Context Protocol: <https://modelcontextprotocol.io>
- OAuth 2.0 (RFC 6749): <https://datatracker.ietf.org/doc/html/rfc6749>
- HMAC-SHA256 (RFC 2104): <https://datatracker.ietf.org/doc/html/rfc2104>
