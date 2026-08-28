# feat-work-item-endpoints

Phase: 18 | Status: [ ] todo
Depends on: 16-secure-setup
Ref: `plans/plane-mcp/00-rfc.md` (Proposed design amendment, 2026-08-15), `docs/plane-api-reference.md` §2.6, §2.4, §3.1, `src/tools/work-items.ts`, `src/tools/modules.ts`, `src/tools/cycles.ts`, `src/tools/states.ts`, `src/plane/client.ts`, `types/client.ts`

## Goal

Fix two confirmed correctness bugs in `list_work_items` and `search_work_items`
against the public Plane REST API (`/api/v1/...`, self-hosted Community): array
filters that are silently dropped by the server, and a search endpoint that
404s outright. Neither bug is a hypothesis — both are confirmed against a live
Community instance (see Problem). This phase ships **behavior fixes only**;
the output shape stays the raw/unprojected shape these two tools return today
except where the fix itself makes today's shape impossible to preserve (the
client-side-scan case — see Design). Field-projection/truncation is Phase 19's
job, not this one, and Phase 19 depends on this phase's output shape because
allowlist projection must run _after_ client-side filtering, never before —
filtering needs fields (`state_id`, `priority`, `assignee_ids`, `label_ids`)
that a projection step would otherwise have already stripped.

## Problem

### Bug 1 — array filters silently dropped by `list_work_items`

`src/tools/work-items.ts` (lines 92-117, `listWorkItems`) comma-joins
`assignee_ids`, `state_ids`, `state_groups`, `priorities`, `label_ids`,
`cycle_ids`, `module_ids` into scalar query-string values and sends them to
`GET /api/v1/workspaces/{slug}/projects/{pid}/work-items/`
(`client.workspacePath('projects/${project_id}/work-items/')`, line 97).
Confirmed against a live self-hosted Community instance: **the public
`/work-items/` list endpoint only honors `cursor`, `per_page`, `order_by`,
`expand`, `fields`, `external_id`, `external_source`.** The seven filter
params above are internal-app-API-only — Plane's own frontend calls a
different, unauthenticated-for-third-parties internal endpoint for filtered
issue views. Sent to the public endpoint, they are silently ignored: the
call succeeds (200), returns the full unfiltered page, and the model has no
signal that its filter request was dropped. `docs/plane-api-reference.md`
§2.6 ("`fields=`/`expand=` — two query parameters everywhere") is the only
documented query-param claim for this endpoint family and does not mention
the seven filter params either — the reference doc simply never claimed they
worked; the existing code's assumption predates any confirmation.

`work-items.test.ts` (lines 17-51, 53-96) currently _asserts_ the
comma-joined-and-sent behavior as correct — those two tests encode the bug
as a passing spec and are rewritten in this phase, not preserved.

### Bug 2 — `search_work_items` 404s on Community

`src/tools/work-items.ts` (lines 220-233, `searchWorkItems`) calls
`GET .../projects/{pid}/work-items/search/?q={query}`. Confirmed: this
endpoint returns 404 on self-hosted Community — Plane's native search
(`work-items/search/`) requires Pro tier's OpenSearch integration, which
Community does not have. `docs/plane-api-reference.md` line 243 documents
this path as if it were universally available; it is not, on the tier this
server targets (self-hosted Community, per the RFC's Problem section — no
OAuth/Pro-only infrastructure).

### What is NOT broken (confirmed, in scope elsewhere or not at all)

- `fields=`/`expand=` scalar passthrough on `/work-items/` — real, unaffected
  by either bug, unchanged by this phase.
- `query` scalar param currently sent by `listWorkItems` (line 99) — not
  named in either confirmed bug; left as-is. Whether the public endpoint
  actually honors a bare `query` scalar is unverified, but inventing a third
  bug beyond the two confirmed ones is explicitly out of scope (see Open
  questions).
- `add_work_items_to_module`/`remove_work_item_from_module`/
  `add_work_items_to_cycle`/`remove_work_item_from_cycle` — these already
  POST/DELETE against `.../modules/{module_id}/work-items/` and
  `.../cycles/{cycle_id}/work-items/` (`modules.ts` lines 67-95, `cycles.ts`
  lines 63-91) and are confirmed working; untouched by this phase except
  that `modules.ts`/`cycles.ts` each gain one new **internal, unregistered**
  GET-listing function alongside the existing POST/DELETE, per Design.

## In scope

- `src/tools/work-items.ts` — `listWorkItems`, `searchWorkItems`: replace the
  broken filter/search behavior per Design. `listWorkItemsSchema`,
  `searchWorkItemsSchema` updated.
- `src/tools/modules.ts` — new exported `fetchModuleWorkItems` (plain
  function, **not** a registered MCP tool — the RFC's 31-tool scope is
  locked; this is an internal helper `listWorkItems` calls).
- `src/tools/cycles.ts` — new exported `fetchCycleWorkItems`, same shape.
- `src/tools/states.ts` — extract the existing `listStates` body into a new
  exported `getProjectStates` plain function (no behavior change to the
  registered `list_states` tool — it now calls `getProjectStates`
  internally); `listWorkItems` calls it to resolve `state_groups` filtering
  (`WorkItem` carries `state_id`, not a state's group — see Design).
- `src/plane/paginate.ts` (new) — `scanPages`, `normalizeToEnvelope`: a
  small, resource-agnostic client-side pagination-scan helper, capped by
  item count and page count, shared by the module/cycle sub-endpoint
  listing and the base-endpoint scan-and-filter/scan-and-search paths.
- `types/paginate.ts` (new) — `PageFetcher<T>`, `ScanPagesOptions`,
  `ScanPagesResult<T>`.
- `types/plane.ts` — add `ScannedResultEnvelope<T>` next to
  `PaginationEnvelope<T>`.
- `types/index.ts` — add `export type * from './paginate';`.
- `src/tools/constants.ts` (new) — `CLIENT_SIDE_SCAN_MAX_ITEMS`,
  `CLIENT_SIDE_SCAN_MAX_PAGES`. **Note for Phase 20**: this file is created
  here, not there — Phase 20 (retrieve-shaping) adds
  `DEFAULT_MAX_DESCRIPTION_CHARS` to this already-existing file instead of
  creating it.
- `src/plane/paginate.test.ts` (new), plus test rewrites/additions in
  `src/tools/work-items.test.ts`, `src/tools/modules.test.ts`,
  `src/tools/cycles.test.ts`, `src/tools/states.test.ts`.

## Out of scope

- Field-projection/truncation of the returned items — Phase 19
  (list-projections). This phase's output items are full, unprojected
  `WorkItem` objects in every branch.
- `search_work_items`'s output field-projection — same, Phase 19.
- Any tool `description` string change — Phase 21 (context-docs) documents
  the new client-side-filtering/search behavior and the page cap there.
- Adding `order_by`, `external_id`, `external_source` as new `list_work_items`
  params — these ARE supported by the public endpoint per the confirmed
  whitelist, but adding them is a new capability, not a bug fix; not part
  of this correctness-only phase (see Open questions).
- Workspace-wide search (`/api/v1/workspaces/{slug}/work-items/search/`,
  `docs/plane-api-reference.md` line 244) — a different, advanced endpoint
  not currently wired to any tool; not introduced here.
- `list_states`'s registered-tool behavior — unchanged; only its internal
  implementation is refactored to expose a reusable helper.

## Design

### Constants (`src/tools/constants.ts`)

```typescript
// Client-side scan-and-filter/scan-and-search caps (Phase 18). Bounds
// worst-case round-trips and result size when a filter Plane's public API
// does not support server-side must be applied in this process instead.
// 20 pages * 100/page (Plane's max per_page) = 2000 raw items examined
// upper bound; only the first 500 matches are ever kept.
export const CLIENT_SIDE_SCAN_MAX_ITEMS = 500;
export const CLIENT_SIDE_SCAN_MAX_PAGES = 20;
```

### `types/paginate.ts`

```typescript
import type { PaginationEnvelope } from './plane';

export type PageFetcher<T> = (cursor: string | undefined) => Promise<PaginationEnvelope<T>>;

export type ScanPagesOptions = {
  maxItems: number;
  maxPages: number;
};

export type ScanPagesResult<T> = {
  items: T[];
  // True when the scan stopped before confirming no further upstream pages
  // exist (item cap hit, page cap hit, or both) — the caller MUST surface
  // this, never silently treat a truncated scan as a complete result set.
  truncated: boolean;
  pagesFetched: number;
};
```

### `types/plane.ts` addition

```typescript
// Envelope shape returned by list_work_items/search_work_items when a
// client-side filter, module_id, or cycle_id triggers a multi-page
// scan-and-filter instead of a direct passthrough of Plane's
// PaginationEnvelope<T> (see plans/plane-mcp/18-work-item-endpoints.md).
export type ScannedResultEnvelope<T> = {
  results: T[];
  count: number;
  scanned_count: number;
  truncated: boolean;
};
```

### `src/plane/paginate.ts`

```typescript
import type { PageFetcher, PaginationEnvelope, ScanPagesOptions, ScanPagesResult } from '@types';

// Wraps a bare array response (module/cycle work-items sub-endpoints may
// return either a plain array or a PaginationEnvelope — confirmed live
// before this function's call sites are wired, see Phase 18 Tasks) into a
// single-page, exhausted envelope so scanPages can treat both shapes
// uniformly.
export function normalizeToEnvelope<T>(raw: T[] | PaginationEnvelope<T>): PaginationEnvelope<T> {
  if (Array.isArray(raw)) {
    return {
      next_cursor: '',
      prev_cursor: '',
      next_page_results: false,
      prev_page_results: false,
      count: raw.length,
      total_pages: 1,
      total_results: raw.length,
      extra_stats: {},
      results: raw,
    };
  }
  return raw;
}

export async function scanPages<T>(fetchPage: PageFetcher<T>, opts: ScanPagesOptions): Promise<ScanPagesResult<T>> {
  const items: T[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let hasMore = true;

  while (hasMore && items.length < opts.maxItems && pagesFetched < opts.maxPages) {
    const envelope = await fetchPage(cursor);
    pagesFetched += 1;
    items.push(...envelope.results);
    hasMore = envelope.next_page_results;
    cursor = envelope.next_cursor;
  }

  const clipped = items.length > opts.maxItems;
  if (clipped) {
    items.length = opts.maxItems;
  }
  const truncated = clipped || (hasMore && (items.length >= opts.maxItems || pagesFetched >= opts.maxPages));

  return { items, truncated, pagesFetched };
}
```

### `src/tools/states.ts` — extract `getProjectStates`

```typescript
export async function getProjectStates(client: PlaneApi, projectId: string): Promise<State[]> {
  return client.get<State[]>(client.workspacePath(`projects/${projectId}/states/`));
}

export async function listStates(client: PlaneApi, args: ListStatesArgs): Promise<ToolResult> {
  const data = await getProjectStates(client, args.project_id);
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { states: data },
  };
}
```

`list_states`'s registered behavior, `inputSchema`, and `description` are
byte-identical before and after — this is a pure extract-function refactor.

### `src/tools/modules.ts` / `src/tools/cycles.ts` — internal GET-listing helpers

Neither function is registered via `registerModuleTools`/`registerCycleTools`
— the RFC's 31-tool scope is locked (00-rfc.md, "Tool scope (exactly 31
tools — locked)"); these are plain exported functions `listWorkItems` calls
directly, the same way `listWorkItems` will call `getProjectStates`.

```typescript
// src/tools/modules.ts
import { scanPages, normalizeToEnvelope } from '../plane/paginate';
import { CLIENT_SIDE_SCAN_MAX_ITEMS, CLIENT_SIDE_SCAN_MAX_PAGES } from './constants';
import type { ScanPagesResult, WorkItem, PaginationEnvelope } from '@types';

export async function fetchModuleWorkItems(
  client: PlaneApi,
  projectId: string,
  moduleId: string
): Promise<ScanPagesResult<WorkItem>> {
  const path = client.workspacePath(`projects/${projectId}/modules/${moduleId}/work-items/`);
  return scanPages<WorkItem>(
    async (cursor) =>
      normalizeToEnvelope(await client.get<WorkItem[] | PaginationEnvelope<WorkItem>>(path, { cursor })),
    { maxItems: CLIENT_SIDE_SCAN_MAX_ITEMS, maxPages: CLIENT_SIDE_SCAN_MAX_PAGES }
  );
}
```

```typescript
// src/tools/cycles.ts — identical shape, cycle path
export async function fetchCycleWorkItems(
  client: PlaneApi,
  projectId: string,
  cycleId: string
): Promise<ScanPagesResult<WorkItem>> {
  const path = client.workspacePath(`projects/${projectId}/cycles/${cycleId}/work-items/`);
  return scanPages<WorkItem>(
    async (cursor) =>
      normalizeToEnvelope(await client.get<WorkItem[] | PaginationEnvelope<WorkItem>>(path, { cursor })),
    { maxItems: CLIENT_SIDE_SCAN_MAX_ITEMS, maxPages: CLIENT_SIDE_SCAN_MAX_PAGES }
  );
}
```

**CRITICAL** — before wiring either of these, the build-time verification
step (Tasks, first item) must confirm the live path segment is literally
`work-items/`, not `module-issues/`/`issue/` or another alias, and that
`normalizeToEnvelope`'s two-shape handling (bare array vs
`PaginationEnvelope`) actually covers what the live endpoint returns.
`docs/plane-api-reference.md` documents the path as `work-items/` (lines
321, 335 — same path as the already-confirmed-working POST/DELETE
add/remove calls), which is supporting evidence, not proof — this same
document's §2.6 and line 243 claims are the two bugs this phase fixes, so
its claims about undocumented response _shape_ (paginated vs. bare array)
carry no weight here and must be curl-verified.

### `src/tools/work-items.ts` — `listWorkItems`

`work-items.ts`'s existing imports (`z`, `McpServer`, `PlaneApi`,
`PaginationEnvelope`, `WorkItem`, `ToolResult`, `toolHandler`,
`toWorkItemWriteBody`) gain:

```typescript
import type { ScanPagesResult, ScannedResultEnvelope, StateGroup } from '@types';
import { scanPages } from '../plane/paginate';
import { CLIENT_SIDE_SCAN_MAX_ITEMS, CLIENT_SIDE_SCAN_MAX_PAGES } from './constants';
import { fetchModuleWorkItems } from './modules';
import { fetchCycleWorkItems } from './cycles';
import { getProjectStates } from './states';
```

Schema: `module_ids`/`cycle_ids` arrays are replaced with singular
`module_id`/`cycle_id` (breaking change — the sub-resource endpoints take
exactly one module/cycle in the path; there is no server-side or
client-side way to intersect two independently-sourced membership lists
without re-fetching full `WorkItem` objects for a set-intersection, which
is out of scope). `assignee_ids`, `state_ids`, `state_groups`, `priorities`,
`label_ids` are kept as arrays — they become client-side-only filters, never
sent as query params.

```typescript
const listWorkItemsSchema = z
  .object({
    project_id: z.string(),
    query: z.string().optional(),
    assignee_ids: z.array(z.string()).optional(),
    state_ids: z.array(z.string()).optional(),
    state_groups: z.array(stateGroup).optional(),
    priorities: z.array(priority).optional(),
    label_ids: z.array(z.string()).optional(),
    module_id: z.string().optional(),
    cycle_id: z.string().optional(),
    cursor: z.string().optional(),
    per_page: z.number().int().min(1).max(100).optional(),
    fields: z.string().optional(),
    expand: z.string().optional(),
  })
  .refine((v) => !(v.module_id !== undefined && v.cycle_id !== undefined), {
    message: 'module_id and cycle_id are mutually exclusive — each sources a separate list.',
    path: ['cycle_id'],
  });
type ListWorkItemsArgs = z.infer<typeof listWorkItemsSchema>;

const CLIENT_SIDE_FILTER_KEYS = ['assignee_ids', 'state_ids', 'state_groups', 'priorities', 'label_ids'] as const;

function hasClientSideFilters(args: ListWorkItemsArgs): boolean {
  return CLIENT_SIDE_FILTER_KEYS.some((key) => (args[key]?.length ?? 0) > 0);
}

async function buildStateGroupMap(client: PlaneApi, projectId: string): Promise<Map<string, StateGroup>> {
  const states = await getProjectStates(client, projectId);
  return new Map(states.map((s) => [s.id, s.group]));
}

function matchesClientFilters(
  item: WorkItem,
  args: ListWorkItemsArgs,
  stateGroupById: Map<string, StateGroup> | undefined
): boolean {
  if (args.assignee_ids && !args.assignee_ids.some((id) => item.assignee_ids.includes(id))) {
    return false;
  }
  if (args.state_ids && !args.state_ids.includes(item.state_id)) return false;
  if (args.priorities && !args.priorities.includes(item.priority)) return false;
  if (args.label_ids && !args.label_ids.some((id) => item.label_ids.includes(id))) return false;
  if (args.state_groups) {
    const group = stateGroupById?.get(item.state_id);
    if (!group || !args.state_groups.includes(group)) return false;
  }
  return true;
}

export async function listWorkItems(client: PlaneApi, args: ListWorkItemsArgs): Promise<ToolResult> {
  const usesSubEndpoint = args.module_id !== undefined || args.cycle_id !== undefined;
  const usesClientFilters = hasClientSideFilters(args);

  if (!usesSubEndpoint && !usesClientFilters) {
    // Unchanged fast path: no filter Plane can't honor server-side was
    // requested, so this is a direct passthrough exactly like today, minus
    // the seven now-removed bogus query params.
    const data = await client.get<PaginationEnvelope<WorkItem>>(
      client.workspacePath(`projects/${args.project_id}/work-items/`),
      {
        query: args.query,
        cursor: args.cursor,
        per_page: args.per_page,
        fields: args.fields,
        expand: args.expand,
      }
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }

  let source: ScanPagesResult<WorkItem>;
  if (args.module_id !== undefined) {
    source = await fetchModuleWorkItems(client, args.project_id, args.module_id);
  } else if (args.cycle_id !== undefined) {
    source = await fetchCycleWorkItems(client, args.project_id, args.cycle_id);
  } else {
    // Client-filter-only case: scan the base endpoint. args.fields is
    // deliberately NOT forwarded here — filtering needs the full raw
    // object (state_id/priority/assignee_ids/label_ids); honoring a
    // caller-supplied fields subset on this internal traffic could silently
    // break filtering. Phase 19 applies field projection client-side, after
    // this scan, for both this branch and the sub-endpoint branches above.
    source = await scanPages<WorkItem>(
      (cursor) =>
        client.get<PaginationEnvelope<WorkItem>>(client.workspacePath(`projects/${args.project_id}/work-items/`), {
          query: args.query,
          cursor,
          per_page: 100,
          expand: args.expand,
        }),
      { maxItems: CLIENT_SIDE_SCAN_MAX_ITEMS, maxPages: CLIENT_SIDE_SCAN_MAX_PAGES }
    );
  }

  const stateGroupById = args.state_groups ? await buildStateGroupMap(client, args.project_id) : undefined;
  const matches = source.items.filter((item) => matchesClientFilters(item, args, stateGroupById));

  const shaped: ScannedResultEnvelope<WorkItem> = {
    results: matches,
    count: matches.length,
    scanned_count: source.items.length,
    truncated: source.truncated,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(shaped) }],
    structuredContent: shaped,
  };
}
```

`per_page`/`cursor` are accepted by the schema but **ignored** whenever the
client-filter/sub-endpoint branch runs — a caller-supplied page size or
cursor cannot drive a multi-page internal scan that returns one aggregated
result set. This is a real, documented behavior difference (Phase 21 tool
description), not a silent inconsistency: the fast passthrough path (no
filters) still honors both exactly as today.

### `src/tools/work-items.ts` — `searchWorkItems`

Drops the `/search/` call entirely. Scans `/work-items/` and matches
case-insensitively against `name` and the numeric `sequence_id` (the
"human identifier" available on `WorkItem` — the project-prefixed form,
e.g. `ENG-42`, requires a project fetch this tool does not make; see Open
questions).

```typescript
const searchWorkItemsSchema = z.object({
  project_id: z.string(),
  query: z.string(),
});
type SearchWorkItemsArgs = z.infer<typeof searchWorkItemsSchema>;

export async function searchWorkItems(client: PlaneApi, args: SearchWorkItemsArgs): Promise<ToolResult> {
  const { project_id, query } = args;
  const scan = await scanPages<WorkItem>(
    (cursor) =>
      client.get<PaginationEnvelope<WorkItem>>(client.workspacePath(`projects/${project_id}/work-items/`), {
        cursor,
        per_page: 100,
      }),
    { maxItems: CLIENT_SIDE_SCAN_MAX_ITEMS, maxPages: CLIENT_SIDE_SCAN_MAX_PAGES }
  );

  const needle = query.toLowerCase();
  const matches = scan.items.filter(
    (item) => item.name.toLowerCase().includes(needle) || String(item.sequence_id).includes(needle)
  );

  const shaped: ScannedResultEnvelope<WorkItem> = {
    results: matches,
    count: matches.length,
    scanned_count: scan.items.length,
    truncated: scan.truncated,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(shaped) }],
    structuredContent: shaped,
  };
}
```

`search_work_items`'s `inputSchema` is unchanged (`project_id`, `query`,
both already required) — only the handler body changes.

## Tasks

- [ ] **Build-time verification (blocking, do first)**: against a live
      self-hosted Plane Community instance, run:
      `curl -s -H "X-API-Key: $PLANE_API_KEY" "$PLANE_BASE_URL/api/v1/workspaces/$SLUG/projects/$PID/modules/$MODULE_ID/work-items/"`
      and the cycle equivalent
      (`.../cycles/$CYCLE_ID/work-items/`). Confirm: (a) the path segment is
      `work-items/`, not an alias; (b) the response is either a bare JSON
      array of objects or a `PaginationEnvelope`-shaped object (record which,
      per endpoint — they need not match); (c) each returned object carries
      `id`, `state_id`, `priority`, `assignee_ids`, `label_ids` (the fields
      `matchesClientFilters` needs) — if the sub-endpoint instead returns
      lightweight join rows lacking these fields, STOP and record this as a
      blocking addendum to this doc before continuing (do not silently
      degrade filtering).
- [ ] Add `src/tools/constants.ts` (`CLIENT_SIDE_SCAN_MAX_ITEMS`,
      `CLIENT_SIDE_SCAN_MAX_PAGES`)
- [ ] Add `types/paginate.ts` (`PageFetcher`, `ScanPagesOptions`,
      `ScanPagesResult`); add `export type * from './paginate';` to
      `types/index.ts`
- [ ] Add `ScannedResultEnvelope<T>` to `types/plane.ts`
- [ ] Write `src/plane/paginate.ts` (`normalizeToEnvelope`, `scanPages`)
- [ ] Write `src/plane/paginate.test.ts`:
  - [ ] `scanPages` stops when `next_page_results` is false before either
        cap is reached; `truncated: false`
  - [ ] `scanPages` stops at `maxItems`, clips `items` to exactly
        `maxItems`, `truncated: true`
  - [ ] `scanPages` stops at `maxPages` while `next_page_results` is still
        true; `truncated: true`
  - [ ] `scanPages` passes each page's `next_cursor` into the following
        `fetchPage` call
  - [ ] `normalizeToEnvelope` wraps a bare array with `next_page_results:
false`; passes a `PaginationEnvelope` through unchanged
- [ ] `src/tools/states.ts` — extract `getProjectStates`; confirm
      `list_states`'s existing tests pass unmodified (pure refactor)
- [ ] `src/tools/modules.ts` — add `fetchModuleWorkItems` (not registered)
- [ ] `src/tools/cycles.ts` — add `fetchCycleWorkItems` (not registered)
- [ ] `src/tools/modules.test.ts` / `src/tools/cycles.test.ts` — add tests
      for the new fetch functions: routes to the correct sub-endpoint path,
      handles a bare-array mocked response, handles a
      `PaginationEnvelope`-mocked response, respects the scan caps
      (mock >`CLIENT_SIDE_SCAN_MAX_PAGES` pages, assert `truncated: true`
      and exactly `CLIENT_SIDE_SCAN_MAX_ITEMS` items returned)
- [ ] `src/tools/work-items.ts` — rewrite `listWorkItemsSchema`
      (`module_ids`/`cycle_ids` → `module_id`/`cycle_id`, mutual-exclusion
      `.refine`), rewrite `listWorkItems` per Design
- [ ] `src/tools/work-items.ts` — rewrite `searchWorkItemsSchema` (no
      change) and `searchWorkItems` per Design
- [ ] Rewrite `src/tools/work-items.test.ts`:
  - [ ] `list_work_items` with no filter args: passthrough path, asserts
        the outgoing query object contains only `query`/`cursor`/`per_page`/
        `fields`/`expand` — no `state_ids`/`priorities`/etc. keys present
        at all (replaces the two now-incorrect tests at the old lines 17-96)
  - [ ] `list_work_items` with `module_id` set: asserts `fetchModuleWorkItems`'s
        underlying `client.get` call targets
        `modules/{module_id}/work-items/`, and the response is the new
        `ScannedResultEnvelope` shape (`results`/`count`/`scanned_count`/
        `truncated`), not the old `PaginationEnvelope` shape
  - [ ] `list_work_items` with `cycle_id` set: same, cycle path
  - [ ] `list_work_items` with `module_id` AND `cycle_id` both set: schema
        `.safeParse` fails (mutual exclusion)
  - [ ] `list_work_items` with `state_ids`/`priorities`/`assignee_ids`/
        `label_ids`: mocked scan returns a fixed item set; asserts only
        matching items appear in `results`, `scanned_count` equals the full
        scanned set size, no `state_ids`/etc. keys ever appear in the
        outgoing `client.get` query
  - [ ] `list_work_items` with `state_groups`: asserts `getProjectStates`
        (via mocked `client.get` to the states path) is called, and
        filtering correctly maps `state_id` → `group` before comparing
  - [ ] `list_work_items` client-filter scan hitting the item/page cap:
        asserts `truncated: true` is present in the response
  - [ ] `search_work_items`: asserts the outgoing `client.get` path is
        `work-items/` (not `work-items/search/`), asserts case-insensitive
        match against `name`, asserts match against `sequence_id` as a
        string, asserts non-matching items are excluded, asserts
        `ScannedResultEnvelope` shape (replaces the old lines 409-436 test)
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes
- [ ] Run `bun run check` — passes

## Definition of done

- [ ] `list_work_items` never sends `assignee_ids`/`state_ids`/
      `state_groups`/`priorities`/`label_ids`/`module_ids`/`cycle_ids` as
      query params to Plane — verified by test, not just by code reading
- [ ] `list_work_items` with `module_id`/`cycle_id` set is verified (live
      curl, Tasks item 1) to hit the correct sub-endpoint and correctly
      parse whichever response shape that endpoint actually returns
- [ ] `search_work_items` never calls `.../work-items/search/` — verified
      by test
- [ ] Every client-side filter (`state_ids`, `state_groups`, `priorities`,
      `assignee_ids`, `label_ids`) is verified correct against a mocked
      multi-item fixture, including the `state_groups` → `state_id`
      resolution path
- [ ] The page/item scan cap is verified by test to (a) bound the number of
      `client.get` calls, and (b) set `truncated: true` when hit
- [ ] `docs/plans/TRACK.md` updated: Phase 18 row `[~]` at start, `[x]` at
      completion

## Open questions

- **`query` scalar param on `/work-items/`** — not named in either
  confirmed bug (Bug 1's confirmed-dropped list is the seven filter params
  specifically); left as a passthrough scalar, unchanged. If a future
  verification pass finds it is also silently ignored, that is a new,
  separate bug report — not assumed here.
- **`order_by`/`external_id`/`external_source`** — confirmed-supported by
  the public endpoint (per the same live confirmation this phase's fix
  relies on) but not currently exposed as `list_work_items` params. Adding
  them is a capability addition, not a correctness fix; deliberately left
  for a future phase rather than silently bundled into this one.
- **Project-prefixed identifier search (`ENG-42`) in `search_work_items`**
  — `WorkItem` carries only the numeric `sequence_id`, not the project's
  `identifier` prefix; matching the full human-facing ticket code would
  require an extra `retrieve_project` fetch per search call. Deliberately
  out of scope — `search_work_items` matches bare `sequence_id` digits and
  `name` substrings only; a query like `"ENG-42"` matches only if `"ENG-42"`
  literally appears in `name`.
- **Module/cycle sub-endpoint pagination semantics** — Task 1's live
  verification may find the endpoint does not accept `cursor`/`per_page` at
  all (i.e., always returns full membership in one bare-array response). If
  so, `fetchModuleWorkItems`/`fetchCycleWorkItems`'s `scanPages` call
  degenerates to exactly one `client.get` call — `normalizeToEnvelope`
  already handles this (bare array → `next_page_results: false`), so no
  code change is anticipated, only a doc note confirming which shape was
  observed, added as a one-line addendum to this Design section per Task 1.
