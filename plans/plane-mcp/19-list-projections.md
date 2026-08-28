# feat-list-projections

Phase: 19 | Status: [ ] todo
Depends on: 17-response-shaping, 18-work-item-endpoints
Ref: `plans/plane-mcp/00-rfc.md` (Proposed design amendment, 2026-08-15), `plans/plane-mcp/17-response-shaping.md`, `plans/plane-mcp/18-work-item-endpoints.md`, `docs/plane-api-reference.md` §2.6, §7

## Goal

Apply `src/plane/select.ts`'s `projectList`/`pickFields` to every
`list_*`/bulk/search tool's default response, replacing today's
JSON.stringify-the-raw-object behavior with a small, explicit per-resource
default field set. Pagination-envelope metadata and plain-array wrapper
shapes are unchanged — only each row's shape shrinks. Every tool gains
`fields`/`full` params so the model can still get the raw object when it
needs to.

**Renumbered from the original Phase 18** to make room for
18-work-item-endpoints, inserted ahead of it: that phase fixes two
confirmed correctness bugs in `list_work_items`/`search_work_items`
(dropped array filters, a 404ing search endpoint) by routing those two
tools through a client-side scan-and-filter path for some calls. This
phase's field-projection step must run _after_ that fix, never before —
projecting away `state_id`/`priority`/`assignee_ids`/`label_ids` before
filtering on them would silently break the filter. Depending on
18-work-item-endpoints (not just 17-response-shaping) makes that ordering
an explicit, checked dependency rather than an implicit one.

## In scope

Tools touched (10): `list_projects`, `list_work_items`,
`search_work_items`, `list_work_item_comments`, `get_project_members`,
`get_workspace_members`, `list_states`, `list_labels`, `list_cycles`,
`list_modules`.

- `src/tools/projects.ts` — `listProjects`
- `src/tools/work-items.ts` — `listWorkItems`, `searchWorkItems`
- `src/tools/comments.ts` — `listWorkItemComments`
- `src/tools/members.ts` — `getProjectMembers`, `getWorkspaceMembers`
- `src/tools/states.ts` — `listStates`
- `src/tools/labels.ts` — `listLabels`
- `src/tools/cycles.ts` — `listCycles`
- `src/tools/modules.ts` — `listModules`
- Corresponding `*.test.ts` updates: default-projection assertions plus
  `full: true` / `fields: [...]` override assertions, for all 10 tools.

## Out of scope

- `retrieve_project`, `retrieve_work_item`,
  `retrieve_work_item_by_identifier` — Phase 20.
- `list_work_item_relations` — already a 3-field type
  (`id`, `related_work_item_id`, `relation_type`) with no known-wide raw
  payload; left unprojected. Revisit only if a future verification pass
  finds Plane's relations endpoint returns a wider object than documented.
- Write tools (`create_*`, `update_*`, `delete_*`, `add_work_items_to_*`,
  `remove_work_item_from_*`) — request bodies and single-object create/
  update responses are already small and caller-authored; out of scope
  per the RFC amendment ("response-shape-only... no write path... touched"
  refers to request bodies specifically, and create/update responses echo
  back what the caller just sent, so there is no volume problem to solve).
- `get_me` — single-object, low-cardinality, workspace-invariant; not in
  the RFC amendment's 13-tool list.
- Any further correctness change to `list_work_items`/`search_work_items`'s
  filtering/search/module/cycle-routing behavior — that surface is closed
  in Phase 18; this phase only projects the fields of whichever items
  Phase 18's logic already decided belong in `results[]`.

## Design

### Default field sets (per resource)

All field names are Plane's raw wire-level names (no read/write renaming —
consistent with `src/plane/normalize.ts`'s existing scope, which only
renames write-body fields).

| Resource (`list_*` tool)                        | Default fields                                                            | Rationale for what's dropped                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects`                                 | `id`, `name`, `identifier`                                                | Enough to identify a project and reference `project_id` in follow-up calls. `description`, `network`, view-toggle flags, lead/assignee UUIDs, timestamps dropped — none are needed to pick a project or route a subsequent tool call.                                                                                         |
| `list_work_items` / `search_work_items`         | `id`, `sequence_id`, `name`, `state_id`, `priority`, `assignee_ids`       | Covers triage: identify, ticket number, title, status, priority, who's on it. `description_html`/`description_stripped`, `label_ids`, `project_id`/`workspace_id` (already known from the request), all timestamps, `created_by_id` dropped — available via `retrieve_work_item` or `fields`.                                 |
| `list_work_item_comments`                       | `id`, `actor_id`, `created_at`, `comment_stripped` (truncated, see below) | Enough to show who said what and when without the full HTML body. `comment_html` (redundant with `comment_stripped`), `issue_id` (already known from the request), `access`, `edited_at`, `updated_at` dropped.                                                                                                               |
| `get_project_members` / `get_workspace_members` | `id`, `member_id`, `role`                                                 | See **Open questions** — the raw member-list payload's shape is not documented in `docs/plane-api-reference.md` §7 (no Member schema there) and not captured by `types/plane.ts`'s `Member` type. Shipping only the 3 fields the current type guarantees are real; do not guess an unverified profile-name field path.        |
| `list_states`                                   | `id`, `name`, `group`, `color`                                            | `sequence`, `default`, `description`, `project_id`, `workspace_id` dropped — `project_id` is already the request's scope.                                                                                                                                                                                                     |
| `list_labels`                                   | `id`, `name`, `color`                                                     | `parent`, `project_id`, `workspace_id` dropped for the same reason as states; `parent` is recoverable via `fields: ['parent']` when building a label hierarchy.                                                                                                                                                               |
| `list_cycles`                                   | `id`, `name`, `start_date`, `end_date`                                    | Refined from the task's initial `id, name` proposal: sprint dates are two small scalar fields and are commonly needed to reason about "what's the current/next cycle" without a follow-up call. `description`, `owned_by`, `sort_order`, `view_props`, `progress_snapshot`, `project_id`, `workspace_id`, timestamps dropped. |
| `list_modules`                                  | `id`, `name`, `start_date`, `target_date`                                 | Same refinement rationale as cycles (Module's date fields are `start_date`/`target_date`, not `end_date` — see `09-sprints.md`'s note on this asymmetry). `description`, `project_id`, `workspace_id`, timestamps dropped.                                                                                                    |

### Comment truncation

`comment_stripped` is truncated via `truncateText` (Phase 17) to
`DEFAULT_MAX_COMMENT_CHARS = 300`, a new constant in `src/tools/comments.ts`
(not `src/plane/select.ts` — the constant is resource-specific, the
truncation mechanism is shared). This is deliberately shorter than
`retrieve_*`'s `2000`-char default (Phase 20), a comment list is a scan
surface, not a read surface — a truncated preview is enough to decide
whether to fetch the full comment.

### `fields=` server-side pushdown decision

Pushed down (query param sent to Plane, shrinking the wire payload before
it ever reaches this process) for `list_projects`, and for `list_work_items`
**only on its unfiltered fast-passthrough path** (Phase 18 Design — no
`module_id`/`cycle_id`/client-side filter present). All other resources in
this phase (comments, members, states, labels, cycles, modules) apply the
projection **client-side only** — `docs/plane-api-reference.md` §2.6 claims
`fields=` works "everywhere," but that claim is not verified against these
specific six endpoints in this codebase, and an invalid `fields=` value
returns a 400 (§2.6) rather than degrading gracefully. Verifying and
extending server-side pushdown to the remaining resources is an explicit
fast-follow, not silently deferred — tracked in Open questions.

### `list_work_items`/`search_work_items` — dual envelope shape (Phase 18 interaction)

Phase 18 gives `listWorkItems` two possible output shapes depending on
which branch ran: the unfiltered fast path returns Plane's
`PaginationEnvelope<WorkItem>` (7 metadata fields + `results`); the
client-filtered/module/cycle-sourced path returns the new
`ScannedResultEnvelope<WorkItem>` (`results`/`count`/`scanned_count`/
`truncated`). `search_work_items` always returns the latter (Phase 18
Design — it always scans). Both shapes share exactly one thing in common:
a `results: WorkItem[]` array. Projection must branch on which shape it
received and spread the correct metadata fields, but always projects
`results` the same way via `projectList`.

```typescript
import { projectList } from '../plane/select';
import type { ProjectionSpec, ProjectionOptions, PaginationEnvelope, ScannedResultEnvelope, WorkItem } from '@types';

// resolveFieldList is used separately in listWorkItems' unfiltered fast
// path to build the fields= pushdown string (same pattern as
// list_projects below) — not needed in this projection-shaping helper,
// which only ever runs pickFields client-side via projectList.
const workItemListSpec: ProjectionSpec<WorkItem> = {
  defaultFields: ['id', 'sequence_id', 'name', 'state_id', 'priority', 'assignee_ids'],
};

function isPaginationEnvelope<T>(
  envelope: PaginationEnvelope<T> | ScannedResultEnvelope<T>
): envelope is PaginationEnvelope<T> {
  return 'next_cursor' in envelope;
}

function shapeWorkItemListResponse(
  envelope: PaginationEnvelope<WorkItem> | ScannedResultEnvelope<WorkItem>,
  opts: ProjectionOptions
): Record<string, unknown> {
  const results = opts.full ? envelope.results : projectList(envelope.results, workItemListSpec, opts, false);
  if (isPaginationEnvelope(envelope)) {
    return {
      next_cursor: envelope.next_cursor,
      prev_cursor: envelope.prev_cursor,
      next_page_results: envelope.next_page_results,
      prev_page_results: envelope.prev_page_results,
      count: envelope.count,
      total_pages: envelope.total_pages,
      total_results: envelope.total_results,
      results,
    };
  }
  return {
    count: envelope.count,
    scanned_count: envelope.scanned_count,
    truncated: envelope.truncated,
    results,
  };
}
```

`listWorkItems`/`searchWorkItems` call `shapeWorkItemListResponse` in place
of their Phase-18 direct-return of `data`/`shaped`. `args.fields`/`args.full`
resolve to `ProjectionOptions` exactly as every other tool in this phase —
the projection step itself does not know or care which upstream branch
produced the envelope; only the metadata-field spread differs.

**No `fields=` pushdown for the scanned branch**: per Phase 18 Design, the
client-filter/module/cycle scan always fetches full raw objects (filtering
needs `state_id`/`priority`/`assignee_ids`/`label_ids` present) — `fields=`
is never sent on that internal traffic, and `pickFields` runs client-side,
after filtering, on the already-fully-fetched items. Pushdown for
`list_work_items` in this phase applies only to the unfiltered fast path
(`shaped` built directly from `client.get`'s `fields=` query param, same as
`list_projects` below).

### Zod schema change (breaking, documented per RFC decision on backward-compat)

`fields: z.string().optional()` (today, a raw passthrough string) becomes
`fields: z.array(z.string()).optional()` (a list of extra raw field names
merged into the default projection) on every touched tool's schema.
`expand` is untouched (`z.string().optional()`, raw passthrough, opt-in
only, not part of the default-projection story). `full: z.boolean().optional()`
is added new. Tools without today's `fields`/`expand` params
(`list_work_item_comments`, `get_project_members`, `get_workspace_members`,
`list_states`, `list_labels`, `list_cycles`, `list_modules`) gain
`fields`/`full` for the first time. `list_work_items`'s schema already
changed once in Phase 18 (`module_ids`/`cycle_ids` → `module_id`/
`cycle_id`); this phase's `fields`/`full` change applies on top of that,
not instead of it.

### `src/tools/projects.ts` (representative — pushdown case)

```typescript
import { projectList, resolveFieldList } from '../plane/select';
import type { ProjectionSpec } from '@types';

const projectSpec: ProjectionSpec<Project> = {
  defaultFields: ['id', 'name', 'identifier'],
};

const listProjectsSchema = z.object({
  cursor: z.string().optional(),
  per_page: z.number().int().min(1).max(100).optional(),
  fields: z.array(z.string()).optional(),
  full: z.boolean().optional(),
  expand: z.string().optional(),
});
type ListProjectsArgs = z.infer<typeof listProjectsSchema>;

export async function listProjects(client: PlaneApi, args: ListProjectsArgs): Promise<ToolResult> {
  const fieldList = resolveFieldList(projectSpec, args);
  const envelope = await client.get<PaginationEnvelope<Project>>(client.workspacePath('projects/'), {
    cursor: args.cursor,
    per_page: args.per_page,
    fields: args.full ? undefined : fieldList.join(','),
    expand: args.expand,
  });
  const shaped = {
    next_cursor: envelope.next_cursor,
    prev_cursor: envelope.prev_cursor,
    next_page_results: envelope.next_page_results,
    prev_page_results: envelope.prev_page_results,
    count: envelope.count,
    total_pages: envelope.total_pages,
    total_results: envelope.total_results,
    results: args.full ? envelope.results : projectList(envelope.results, projectSpec, args, false),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(shaped) }],
    structuredContent: shaped,
  };
}
```

`extra_stats` is intentionally omitted from `shaped` by default (dropped,
not `undefined`-filled) — it is a `Record<string, unknown>` grab-bag with
no fixed shape (Phase 17 Design). When `args.full` is set, return the
original `envelope` object unmodified instead of building `shaped`, so
`full: true` is a genuine, total bypass (including `extra_stats`).

### `src/tools/comments.ts` (representative — client-side-only + truncation)

```typescript
import { projectList, resolveFieldList, truncateText } from '../plane/select';
import type { ProjectionSpec } from '@types';

const DEFAULT_MAX_COMMENT_CHARS = 300;

const commentSpec: ProjectionSpec<Comment> = {
  defaultFields: ['id', 'actor_id', 'created_at', 'comment_stripped'],
};

const listWorkItemCommentsSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  fields: z.array(z.string()).optional(),
  full: z.boolean().optional(),
});
type ListWorkItemCommentsArgs = z.infer<typeof listWorkItemCommentsSchema>;

export async function listWorkItemComments(client: PlaneApi, args: ListWorkItemCommentsArgs): Promise<ToolResult> {
  const envelope = await client.get<PaginationEnvelope<Comment>>(
    client.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/comments/`)
  );
  const results = args.full
    ? envelope.results
    : projectList(envelope.results, commentSpec, args, false).map((row) => {
        const body = row.comment_stripped;
        if (typeof body === 'string') {
          return { ...row, comment_stripped: truncateText(body, DEFAULT_MAX_COMMENT_CHARS).text };
        }
        return row;
      });
  const shaped = { ...envelope, results };
  return {
    content: [{ type: 'text', text: JSON.stringify(shaped) }],
    structuredContent: shaped,
  };
}
```

Every other touched tool follows one of these two shapes (pushdown +
envelope for the unfiltered `list_work_items` path; client-side-only +
plain-array wrapper — `{ states: [...] }`/`{ labels: [...] }`/
`{ cycles: [...] }`/`{ modules: [...] }`/`{ members: [...] }` — for
states/labels/cycles/modules/members, matching each tool's existing
wrapper key), plus `list_work_items`/`search_work_items`'s dual-shape
handling above. None of the plain-array tools have pagination envelopes
today (`Cycle[]`/`Module[]`/`State[]`/`Label[]`/`Member[]` return types)
— that is unchanged; only the array's element shape is projected.

## Tasks

- [ ] `src/tools/projects.ts` — wire `projectList` + pushdown, update
      `listProjectsSchema`
- [ ] `src/tools/work-items.ts` — wire `shapeWorkItemListResponse` into
      `listWorkItems`/`searchWorkItems`, add `fields`/`full` to both
      schemas (`listWorkItemsSchema` already has `module_id`/`cycle_id`
      from Phase 18 — add `fields`/`full` alongside; `searchWorkItemsSchema`
      currently has no `fields`/`cursor`/`per_page` params at all — add
      `fields`/`full`; leave `cursor`/`per_page` addition out of scope,
      Phase 18 already fixed `search_work_items` to always scan
      internally, exposing a caller-facing `cursor`/`per_page` on top of
      that scan is a separate capability, not part of this projection
      phase)
- [ ] `src/tools/comments.ts` — wire `projectList` + `truncateText`,
      update `listWorkItemCommentsSchema`
- [ ] `src/tools/members.ts` — wire `projectList` for both tools, update
      both schemas
- [ ] `src/tools/states.ts` — wire `projectList` for `listStates` (built on
      top of Phase 18's `getProjectStates` extraction — `listStates` now
      calls `getProjectStates` then projects the result), update schema
- [ ] `src/tools/labels.ts` — wire `projectList` for `listLabels`, update
      schema
- [ ] `src/tools/cycles.ts` — wire `projectList` for `listCycles`, update
      schema
- [ ] `src/tools/modules.ts` — wire `projectList` for `listModules`,
      update schema
- [ ] Update all 8 non-work-item touched `*.test.ts` files:
  - [ ] default call (no `fields`/`full`) asserts the response contains
        exactly the documented default field set per row, nothing else
  - [ ] `full: true` asserts the response row equals the raw mocked
        source object, including a field outside the default set
  - [ ] `fields: [...]` asserts the named extra field is merged in
        alongside the defaults
  - [ ] pagination-envelope tools (`list_projects`, `list_work_item_comments`)
        assert all envelope metadata fields pass through unmodified and
        `extra_stats` is absent by default
  - [ ] `list_work_item_comments` asserts `comment_stripped` truncation at
        `DEFAULT_MAX_COMMENT_CHARS` with both an under-limit and
        over-limit mocked comment body
  - [ ] `list_projects` asserts the outgoing `client.get` query's `fields`
        param equals the resolved default list comma-joined, and is
        `undefined` when `full: true`
- [ ] Update `src/tools/work-items.test.ts`:
  - [ ] unfiltered `list_work_items` default call: response has the 6-field
        default projection, envelope metadata (7 fields) intact, outgoing
        `fields=` query param pushed down
  - [ ] `module_id`/`cycle_id`-sourced `list_work_items`: response is
        `count`/`scanned_count`/`truncated`/`results` shaped, `results`
        projected to the 6-field default
  - [ ] client-filtered `list_work_items` (e.g. `state_ids`): same
        scanned-shape assertion, and outgoing scan `client.get` calls never
        carry a `fields=` param (full objects fetched, filtered, then
        projected)
  - [ ] `search_work_items`: scanned-shape assertion, projected `results`
  - [ ] `full: true` on both tools returns unprojected raw items in
        whichever envelope shape the branch produced
  - [ ] `fields: [...]` merges an extra field into the default set on both
        tools
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes
- [ ] Run `bun run check` — passes

## Definition of done

- [ ] All 10 tools return the documented default field set by default,
      the raw object under `full: true`, and defaults-plus-extras under
      `fields: [...]`
- [ ] Every pagination-envelope tool's metadata fields are byte-identical
      to what Plane returned, in both default and `full` modes;
      `list_work_items`'s scanned-shape metadata (`count`/`scanned_count`/
      `truncated`) is likewise untouched by projection
- [ ] `list_projects` and `list_work_items`'s unfiltered path verified to
      push a resolved `fields=` string down to Plane by default (query
      param assertion in tests, not just response-shape assertion);
      `list_work_items`'s filtered/scanned path verified to NEVER push
      `fields=` down (full-object fetch is load-bearing for filter
      correctness)
- [ ] `docs/plans/TRACK.md` updated: Phase 19 row `[~]` at start, `[x]` at
      completion

## Open questions

- **Member profile field path is unverified.** `get_project_members`/
  `get_workspace_members`'s raw payload almost certainly carries more than
  `id`/`member_id`/`role` (a bare ID triple is not human-usable to
  distinguish members), but neither `docs/plane-api-reference.md` §7 nor
  `types/plane.ts`'s `Member` type documents a profile/display-name field,
  and this plan cannot call the live API to confirm one. **Do not block
  this phase on it** — ship the 3 verified-real fields as the default. If,
  during implementation, a real request/response confirms a stable field
  path (e.g. a nested `member.display_name` or top-level `display_name`),
  extend `memberSpec.defaultFields` to include it as a small addendum to
  this phase (update this doc's table + `types/plane.ts`'s `Member` type
  to reflect the newly-confirmed field) rather than deferring to a new
  phase — this is a one-line addition, not a new design.
- **`fields=` pushdown for comments/members/states/labels/cycles/modules**
  is deferred (client-side-only projection for now, per the Design
  decision table). A fast-follow phase can verify each endpoint's actual
  `fields=` support against a live workspace and extend pushdown — tracked
  here so it isn't silently forgotten, not scheduled as part of this
  feature.
