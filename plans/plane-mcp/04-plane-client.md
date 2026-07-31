# feat-plane-client

Phase: 04 | Status: [ ] planned
Depends on: 03-transport
Ref: `plans/plane-mcp/00-rfc.md`, `../../../docs/plane-api-reference.md` §2, §7.1, §7.9, §9.5

## Goal

Build the single `PlaneClient` class that every tool calls through: base URL

- `X-API-Key` header injection, cursor pagination passthrough, 429 handling
  with backoff, typed errors, and field-normalization helpers for the
  work-item read/write asymmetry.

## In scope

- `src/plane/client.ts` — `PlaneClient` class over native `fetch`.
- `src/plane/errors.ts` — `PlaneApiError` typed error.
- `src/plane/normalize.ts` — work-item field normalization helpers
  (`toWorkItemWriteBody`, `fromWorkItemReadShape` or equivalent — exact
  function names decided here, used everywhere from Phase 06 onward).
- `types/plane.ts` — real wire-shape types (`WorkItem`, `Project`, `Cycle`,
  `Module`, `State`, `Label`, `Comment`, `Relation`, `Member`,
  `PaginationEnvelope<T>`) replacing the Phase 01 placeholder.
- `src/plane/client.test.ts` — unit tests with mocked `fetch`.

## Out of scope

- Any tool registration or zod schema (Phase 05+).
- Resource-specific request builders beyond the generic `get`/`post`/
  `patch`/`delete` methods — e.g. no `client.listWorkItems(...)` method here;
  that composition happens in `src/tools/work-items.ts` (Phase 06) using the
  generic methods below.
- OAuth bearer credential path (non-goal per `00-rfc.md`).

## Design

### `types/plane.ts`

```typescript
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

export type RelationType = 'blocking' | 'blocked_by' | 'duplicate_of' | 'duplicate' | 'relates_to';

export type PaginationEnvelope<T> = {
  next_cursor: string;
  prev_cursor: string;
  next_page_results: boolean;
  prev_page_results: boolean;
  count: number;
  total_pages: number;
  total_results: number;
  extra_stats: Record<string, unknown>;
  results: T[];
};

// Read shape — exactly what Plane's API returns for a work item.
export type WorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  description_html: string;
  description_stripped: string;
  priority: Priority;
  state_id: string;
  type_id: string | null;
  parent_id: string | null;
  project_id: string;
  workspace_id: string;
  assignee_ids: string[];
  label_ids: string[];
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_id: string;
};

// Write shape — the body accepted by POST/PATCH work-items endpoints.
// Field names intentionally differ from WorkItem (see normalize.ts).
export type WorkItemWriteBody = {
  name?: string;
  description_html?: string;
  priority?: Priority;
  state?: string;
  assignees?: string[];
  labels?: string[];
  type_id?: string;
  parent?: string | null;
  start_date?: string;
  target_date?: string;
  estimate_point?: string;
  external_id?: string;
  external_source?: string;
};

export type Project = {
  id: string;
  name: string;
  identifier: string;
  description: string;
  network: 0 | 2;
  workspace: string;
  workspace_slug: string;
  created_at: string;
  updated_at: string;
};

export type Cycle = {
  id: string;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  project_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
};

export type Module = {
  id: string;
  name: string;
  description: string;
  start_date: string | null;
  target_date: string | null;
  project_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
};

export type State = {
  id: string;
  name: string;
  color: string;
  group: StateGroup;
  sequence: number;
  default: boolean;
  description: string;
  project_id: string;
  workspace_id: string;
};

export type Label = {
  id: string;
  name: string;
  color: string;
  parent: string | null;
  project_id: string;
  workspace_id: string;
};

export type Comment = {
  id: string;
  issue_id: string;
  actor_id: string;
  comment_html: string;
  comment_stripped: string;
  access: 'INTERNAL' | 'EXTERNAL';
  created_at: string;
  updated_at: string;
};

export type Relation = {
  id: string;
  related_work_item_id: string;
  relation_type: RelationType;
};

export type Member = {
  id: string;
  member_id: string;
  role: number;
  workspace_id: string;
  project_id?: string;
};
```

**Note**: only fields actually consumed by the ~25 in-scope tools are
modeled. Fields present on the wire but never read/written by this server
(e.g. `sort_order`, `is_draft`, `external_source` on read, `view_props`,
`progress_snapshot`) are omitted rather than guessed — add them in the phase
that first needs them, not speculatively here.

### `src/plane/errors.ts`

```typescript
export class PlaneApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Plane API error ${status}: ${body}`);
    this.name = 'PlaneApiError';
    this.status = status;
    this.body = body;
  }
}

export class PlaneRateLimitError extends PlaneApiError {
  readonly resetAt: number;

  constructor(body: string, resetAt: number) {
    super(429, body);
    this.name = 'PlaneRateLimitError';
    this.resetAt = resetAt;
  }
}
```

`PlaneRateLimitError` extends `PlaneApiError` (only case in this codebase
where `extends` on a `class`, not `interface`, applies — see
`docs/CODING-STANDARDS.md` exception for class extension) so callers can
`catch (err) { if (err instanceof PlaneApiError) ... }` uniformly, while
tools that specifically want to surface rate-limit detail can narrow with
`instanceof PlaneRateLimitError`.

### `src/plane/client.ts`

```typescript
import type { AuthContext } from '@types/config';
import { PlaneApiError, PlaneRateLimitError } from './errors';
import { log } from '../logger';

const MAX_RETRIES = 3;

type RequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export class PlaneClient {
  private readonly auth: AuthContext;

  constructor(auth: AuthContext) {
    this.auth = auth;
  }

  workspacePath(sub: string): string {
    return `/api/v1/workspaces/${this.auth.workspaceSlug}/${sub.replace(/^\//, '')}`;
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>({ method: 'GET', path, query });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', path, body });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>({ method: 'DELETE', path });
  }

  private async request<T>(options: RequestOptions, attempt = 0): Promise<T> {
    const url = new URL(options.path, this.auth.baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    log('debug', 'Calling Plane API', {
      operation: 'api_request',
      endpoint: options.path,
      method: options.method,
    });

    const response = await fetch(url.toString(), {
      method: options.method,
      headers: {
        'X-API-Key': this.auth.apiKey,
        'Content-Type': 'application/json',
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    log('debug', 'Plane API response', {
      operation: 'api_response',
      endpoint: options.path,
      statusCode: response.status,
    });

    if (response.status === 429) {
      const resetHeader = response.headers.get('X-RateLimit-Reset');
      const resetAt = resetHeader ? Number.parseInt(resetHeader, 10) : 0;
      if (attempt < MAX_RETRIES) {
        const waitSeconds = Math.max(1, resetAt - Math.floor(Date.now() / 1000));
        log('warn', 'Rate limited, backing off', {
          operation: 'api_rate_limit',
          endpoint: options.path,
          statusCode: 429,
          waitSeconds,
        });
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitSeconds, 30) * 1000));
        return this.request<T>(options, attempt + 1);
      }
      const body = await response.text();
      log('error', 'Rate limit retries exhausted', {
        operation: 'api_error',
        endpoint: options.path,
        statusCode: 429,
      });
      throw new PlaneRateLimitError(body, resetAt);
    }

    if (response.status >= 400) {
      const body = await response.text();
      log('error', 'Plane API request failed', {
        operation: 'api_error',
        endpoint: options.path,
        statusCode: response.status,
        error: body,
      });
      throw new PlaneApiError(response.status, body);
    }

    if (response.status === 204 || !response.headers.get('content-length')) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
```

**CRITICAL — 429 never swallowed**: after `MAX_RETRIES` backoff attempts, the
method throws `PlaneRateLimitError` rather than returning a default/empty
value. Every tool (Phase 05+) lets this propagate up to the tool-wrapper
error mapper (Phase 05 Design), which converts it into an `isError` tool
result — the model sees the rate limit, it is never hidden as a false
"success with no results".

**CRITICAL — no auto-paging**: `PlaneClient` has no `listAll`/`iterate`
helper. `cursor` and `per_page` are passed straight through as query params
by the calling tool (Phase 06); `PlaneClient.get<T>` returns whatever
envelope Plane sends, untouched.

**Note on `workspacePath`**: every workspace-scoped call goes through this
helper so the `/api/v1/workspaces/{slug}/` prefix is written in exactly one
place. Tools call `client.get(client.workspacePath('projects/'))`, never
hand-construct the prefix.

### `src/plane/normalize.ts`

```typescript
import type { WorkItemWriteBody } from '@types/plane';

export type WorkItemWriteInput = {
  name?: string;
  descriptionHtml?: string;
  priority?: WorkItemWriteBody['priority'];
  stateId?: string;
  assigneeIds?: string[];
  labelIds?: string[];
  typeId?: string;
  parentId?: string | null;
  startDate?: string;
  dueDate?: string;
  estimatePoint?: string;
  externalId?: string;
  externalSource?: string;
};

/**
 * Maps the MCP tool's read-shape-named arguments (state_id, assignee_ids,
 * due_date — matching how the model sees a retrieved work item) onto the
 * write-shape body Plane's POST/PATCH endpoints actually expect (state,
 * assignees, target_date). See ../../../docs/plane-api-reference.md section 7.1.
 */
export function toWorkItemWriteBody(input: WorkItemWriteInput): WorkItemWriteBody {
  const body: WorkItemWriteBody = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.descriptionHtml !== undefined) body.description_html = input.descriptionHtml;
  if (input.priority !== undefined) body.priority = input.priority;
  if (input.stateId !== undefined) body.state = input.stateId;
  if (input.assigneeIds !== undefined) body.assignees = input.assigneeIds;
  if (input.labelIds !== undefined) body.labels = input.labelIds;
  if (input.typeId !== undefined) body.type_id = input.typeId;
  if (input.parentId !== undefined) body.parent = input.parentId;
  if (input.startDate !== undefined) body.start_date = input.startDate;
  if (input.dueDate !== undefined) body.target_date = input.dueDate;
  if (input.estimatePoint !== undefined) body.estimate_point = input.estimatePoint;
  if (input.externalId !== undefined) body.external_id = input.externalId;
  if (input.externalSource !== undefined) body.external_source = input.externalSource;
  return body;
}
```

The reverse direction (read shape -> tool output) needs **no** mapping
function: `WorkItem` (read shape) is returned to the model as-is — the tool
output surfaces `state_id`/`assignee_ids`/`target_date` directly, since
that's the shape Plane's GET endpoints already return and the shape
`retrieve_work_item`/`list_work_items` promise. Only the write direction
needs translation. Phase 06 tools import `toWorkItemWriteBody` for
`create_work_item`/`update_work_item` and pass `WorkItem` straight through
for reads.

### `src/plane/client.test.ts` — required coverage

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { PlaneClient } from './client';
import { PlaneApiError, PlaneRateLimitError } from './errors';

const AUTH = { apiKey: 'test-key', workspaceSlug: 'acme', baseUrl: 'https://api.plane.so' };

describe('PlaneClient', () => {
  it('should build the correct URL and inject X-API-Key header', async () => {
    const fetchMock = mock(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.plane.so/api/v1/workspaces/acme/projects/');
      expect((init.headers as Record<string, string>)['X-API-Key']).toBe('test-key');
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new PlaneClient(AUTH);
    await client.get(client.workspacePath('projects/'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should pass the pagination envelope through untouched', async () => {
    const envelope = { next_cursor: '20:1:0', results: [{ id: '1' }] };
    globalThis.fetch = mock(async () => new Response(JSON.stringify(envelope), { status: 200 })) as typeof fetch;

    const client = new PlaneClient(AUTH);
    const result = await client.get('/api/v1/workspaces/acme/projects/');
    expect(result).toEqual(envelope);
  });

  it('should retry on 429 and eventually throw PlaneRateLimitError after MAX_RETRIES', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000)) },
        })
    ) as typeof fetch;

    const client = new PlaneClient(AUTH);
    await expect(client.get('/api/v1/workspaces/acme/projects/')).rejects.toBeInstanceOf(PlaneRateLimitError);
  });

  it('should throw PlaneApiError for 4xx/5xx responses', async () => {
    globalThis.fetch = mock(async () => new Response('not found', { status: 404 })) as typeof fetch;

    const client = new PlaneClient(AUTH);
    await expect(client.get('/api/v1/workspaces/acme/projects/missing/')).rejects.toBeInstanceOf(PlaneApiError);
  });
});
```

**IMPORTANT**: the 429-retry test above uses a reset timestamp of "now" so
the backoff sleep is ~0-1s and the test stays fast; do not use a
far-future reset timestamp in tests (it will make the suite hang up to the
30s cap).

## Tasks

- [ ] Write `types/plane.ts` with all wire-shape types above
- [ ] Write `src/plane/errors.ts` (`PlaneApiError`, `PlaneRateLimitError`)
- [ ] Write `src/plane/client.ts` (`PlaneClient` class)
- [ ] Write `src/plane/normalize.ts` (`toWorkItemWriteBody`)
- [ ] Write `src/plane/client.test.ts` per the required coverage above
- [ ] Run `bun test src/plane` — all tests green
- [ ] Run `bun run typecheck` — passes

## Definition of done

- [ ] Unit tests cover: URL building, header injection, pagination envelope
      passthrough, 429 -> `PlaneRateLimitError` after retries, 4xx/5xx ->
      `PlaneApiError`
- [ ] No test makes a real network call (all `fetch` calls mocked)
- [ ] `toWorkItemWriteBody` unit-tested for at least one field of each kind
      (renamed field, passthrough field, omitted-when-undefined field) — add
      these cases to `client.test.ts` or a sibling `normalize.test.ts`
- [ ] `docs/plans/TRACK.md` updated: Phase 04 row `[~]` at start, `[x]` at
      completion

## Open questions

- Whether `PlaneClient` should expose `fields`/`expand` passthrough as a
  generic `query` param (already covered by the generic `get<T>(path,
query)` signature) or as named parameters is resolved here: generic
  `query` bag, so no client-side change is needed as new resources add
  `fields`/`expand` support in later phases.
- `MAX_RETRIES = 3` is a free implementation choice (spec report does not
  mandate a count) — confirmed here as the value; revisit only if a phase
  hits a real-world case where 3 retries under the 30s cap is insufficient.
