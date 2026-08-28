# feat-retrieve-shaping

Phase: 20 | Status: [ ] todo
Depends on: 17-response-shaping
Ref: `plans/plane-mcp/00-rfc.md` (Proposed design amendment, 2026-08-15), `plans/plane-mcp/17-response-shaping.md`, `docs/plane-api-reference.md` §7.1, §7.2

## Goal

Apply `src/plane/select.ts`'s `projectItem` to the three retrieve-by-id
tools with a fuller default field set than Phase 19's list tools, and cap
each resource's one long-text field (`description_html` /
`description`) at a default length with an explicit truncation marker
instead of dropping it — a retrieve is a read surface, not a scan surface,
so the caller gets the field, just capped. Every tool gains
`fields`/`full`/`max_description_chars`.

**Renumbered from the original Phase 19** — unchanged in scope or design
from that version. Phase 18 (work-item-endpoints) fixes `list_work_items`/
`search_work_items` only; `retrieve_work_item`,
`retrieve_work_item_by_identifier`, and `retrieve_project` fetch a single
object by ID with no array-filter/search surface, so neither of Phase 18's
confirmed bugs applies to them, and this phase has no dependency on Phase 18.

## In scope

- `src/tools/work-items.ts` — `retrieveWorkItem`,
  `retrieveWorkItemByIdentifier` (the latter currently has **no**
  `fields`/`expand` params at all; this phase adds `fields`/`full`/
  `max_description_chars` to it for the first time, closing that gap).
- `src/tools/projects.ts` — `retrieveProject`.
- Corresponding test updates in `src/tools/work-items.test.ts` and
  `src/tools/projects.test.ts`.

## Out of scope

- All 10 `list_*`/bulk/search tools — Phase 19.
- `list_work_items`/`search_work_items`'s filtering/search/module/cycle
  routing — Phase 18; untouched here.
- `get_me` — single-object, not in the RFC amendment's 13-tool list, and
  has no long-text field to truncate.
- Any change to `create_work_item`/`update_work_item`/`create_state`/etc.
  request bodies or their single-object responses — those echo back what
  the caller just sent; no volume problem to solve (Phase 19 Out of scope
  rationale applies identically here).

## Design

### Default field sets

| Tool                                                      | Default fields                                                                                                                                                                                                                       | Truncated field                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `retrieve_work_item` / `retrieve_work_item_by_identifier` | `id`, `name`, `sequence_id`, `description_html`, `priority`, `state_id`, `type_id`, `parent_id`, `project_id`, `assignee_ids`, `label_ids`, `start_date`, `target_date`, `completed_at`, `created_at`, `updated_at`, `created_by_id` | `description_html`, default `2000` chars |
| `retrieve_project`                                        | `id`, `name`, `identifier`, `description`, `network`, `workspace_slug`, `default_state`, `created_at`, `updated_at`                                                                                                                  | `description`, default `2000` chars      |

Dropped from `retrieve_work_item`'s default (per §7.1's documented wire
shape): `description_stripped` (redundant with truncated
`description_html`), `description_json` (structured-doc internal
representation, not model-readable text), `estimate_point_id`, `point`,
`sort_order`, `is_draft`, `external_source`, `external_id`,
`last_activity_at`, `archived_at`, `deleted_at`, `updated_by_id`,
`workspace_id` (already implied by `project_id` + the configured
workspace). All recoverable via `fields: [...]` or `full: true`.

Dropped from `retrieve_project`'s default (per §7.2): `workspace` (UUID
duplicate of the purpose `workspace_slug` already serves), `created_by`,
`default_assignee`, `project_lead`, `estimate`, the four `*_view`
booleans, `cover_image`, `archive_in`, `close_in`, plus any undocumented
extra fields (`logo_props`, `timezone`, `total_members`, etc. — Phase 17
Problem section) — the allowlist mechanism drops these automatically
without needing to name them.

`DEFAULT_MAX_DESCRIPTION_CHARS = 2000` is a shared constant (not
per-resource) added to `src/tools/constants.ts` — that file is created in
Phase 18 (`CLIENT_SIDE_SCAN_MAX_ITEMS`/`CLIENT_SIDE_SCAN_MAX_PAGES`), not
this phase; this phase adds one more named export to the already-existing
file rather than creating it, and does not duplicate the literal `2000`
anywhere else.

### `max_description_chars` param

Overrides the truncation cap for a single call
(`opts.maxChars` in `src/plane/select.ts`'s `projectItem`). Setting it to
a very large number is the caller's way of getting the full description
without also disabling the field allowlist (unlike `full: true`, which
disables both). Zod: `z.number().int().min(1).optional()` — no upper
bound enforced here (an oversized value simply means "don't truncate in
practice"; Plane's own response size is the real ceiling).

### `src/tools/work-items.ts` (retrieve tools)

```typescript
import { projectItem } from '../plane/select';
import type { ProjectionSpec } from '@types';
import { DEFAULT_MAX_DESCRIPTION_CHARS } from './constants';

const workItemSpec: ProjectionSpec<WorkItem> = {
  defaultFields: [
    'id',
    'name',
    'sequence_id',
    'description_html',
    'priority',
    'state_id',
    'type_id',
    'parent_id',
    'project_id',
    'assignee_ids',
    'label_ids',
    'start_date',
    'target_date',
    'completed_at',
    'created_at',
    'updated_at',
    'created_by_id',
  ],
  truncatable: [{ field: 'description_html', defaultMaxChars: DEFAULT_MAX_DESCRIPTION_CHARS }],
};

const retrieveWorkItemSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  fields: z.array(z.string()).optional(),
  full: z.boolean().optional(),
  max_description_chars: z.number().int().min(1).optional(),
  expand: z.string().optional(),
});
type RetrieveWorkItemArgs = z.infer<typeof retrieveWorkItemSchema>;

export async function retrieveWorkItem(client: PlaneApi, args: RetrieveWorkItemArgs): Promise<ToolResult> {
  const { project_id, work_item_id, fields, full, max_description_chars, expand } = args;
  const opts = { fields, full, maxChars: max_description_chars };
  const fieldList = opts.full
    ? undefined
    : Array.from(new Set([...workItemSpec.defaultFields, ...(fields ?? [])])).join(',');
  const workItem = await client.get<WorkItem>(
    client.workspacePath(`projects/${project_id}/work-items/${work_item_id}/`),
    { fields: fieldList, expand }
  );
  const shaped = opts.full ? workItem : projectItem(workItem, workItemSpec, opts, true);
  return {
    content: [{ type: 'text', text: JSON.stringify(shaped) }],
    structuredContent: shaped,
  };
}
```

`fields=` **is** pushed down here (project + work-item retrieve endpoints
are the two already-verified pushdown resources, per Phase 19's decision
table) — this reduces which whole fields transit from Plane (dropping
`description_json`, `sort_order`, `is_draft`, etc. entirely), but
`description_html` itself must still transit in full before it can be
truncated client-side: Plane's `fields=` selects whole fields, it cannot
truncate a field's value. `projectItem`'s truncation step (Phase 17)
always runs after the fetch, never before — this is the concrete
instance of the RFC amendment's "field selection applied after fetch;
where the API supports `fields=`, also push it down to shrink transfer."

`retrieveWorkItemByIdentifier` is rewritten to the identical shape (same
`workItemSpec`, same schema additions), the only difference being its
path builder (`work-items/identifier/{project_identifier}-{work_item_identifier}/`)
and that it currently constructs no query object at all — this phase adds
one.

### `src/tools/projects.ts` (`retrieveProject`)

```typescript
import { projectItem } from '../plane/select';
import type { ProjectionSpec } from '@types';
import { DEFAULT_MAX_DESCRIPTION_CHARS } from './constants';

const projectRetrieveSpec: ProjectionSpec<Project> = {
  defaultFields: [
    'id',
    'name',
    'identifier',
    'description',
    'network',
    'workspace_slug',
    'default_state',
    'created_at',
    'updated_at',
  ],
  truncatable: [{ field: 'description', defaultMaxChars: DEFAULT_MAX_DESCRIPTION_CHARS }],
};

const retrieveProjectSchema = z.object({
  project_id: z.string(),
  fields: z.array(z.string()).optional(),
  full: z.boolean().optional(),
  max_description_chars: z.number().int().min(1).optional(),
  expand: z.string().optional(),
});
type RetrieveProjectArgs = z.infer<typeof retrieveProjectSchema>;

export async function retrieveProject(client: PlaneApi, args: RetrieveProjectArgs): Promise<ToolResult> {
  const { project_id, fields, full, max_description_chars, expand } = args;
  const opts = { fields, full, maxChars: max_description_chars };
  const fieldList = full
    ? undefined
    : Array.from(new Set([...projectRetrieveSpec.defaultFields, ...(fields ?? [])])).join(',');
  const project = await client.get<Project>(client.workspacePath(`projects/${project_id}/`), {
    fields: fieldList,
    expand,
  });
  const shaped = full ? project : projectItem(project, projectRetrieveSpec, opts, true);
  return {
    content: [{ type: 'text', text: JSON.stringify(shaped) }],
    structuredContent: shaped,
  };
}
```

**Note**: `default_state` (the `Project`-level default state UUID field
documented in §7.2) is not currently in `types/plane.ts`'s `Project`
type — adding it to the default field set here means it must also be
added to the `Project` type as an optional field (`default_state:
string | null`) in this phase, since `pickFields<T>`'s `keyof T`
constraint on `ProjectionSpec<T>.defaultFields` requires it to be a known
key. This is the one `types/plane.ts` change in this phase; every other
field named above already exists on `Project`/`WorkItem`.

## Tasks

- [ ] Add `DEFAULT_MAX_DESCRIPTION_CHARS = 2000` to the existing
      `src/tools/constants.ts` (created in Phase 18)
- [ ] Add `default_state: string | null` to `types/plane.ts`'s `Project`
      type
- [ ] `src/tools/work-items.ts` — wire `projectItem` + pushdown into
      `retrieveWorkItem`, update its schema
- [ ] `src/tools/work-items.ts` — wire the identical treatment into
      `retrieveWorkItemByIdentifier`, adding `fields`/`full`/
      `max_description_chars` params it did not previously have
- [ ] `src/tools/projects.ts` — wire `projectItem` + pushdown into
      `retrieveProject`, update its schema
- [ ] Update `src/tools/work-items.test.ts`:
  - [ ] `retrieve_work_item` default call asserts exactly the documented
        17-field set on the response, with `description_html` truncated
        when the mocked source exceeds 2000 chars
  - [ ] `retrieve_work_item` under-2000-char `description_html` is
        returned unmodified (no marker appended)
  - [ ] `max_description_chars: 50` overrides the default cap
  - [ ] `full: true` returns the raw mocked object including a field
        outside the default set
  - [ ] `fields: [...]` merges an extra field into the default set
  - [ ] outgoing `client.get` query's `fields` param equals the resolved
        default list comma-joined, `undefined` under `full: true`
  - [ ] `retrieve_work_item_by_identifier` gets the same 6 assertions as
        `retrieve_work_item` (schema previously had none of these params
        — confirm they are net-new, not modified)
- [ ] Update `src/tools/projects.test.ts` — same 6-assertion shape for
      `retrieve_project`
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes
- [ ] Run `bun run check` — passes

## Definition of done

- [ ] `retrieve_work_item`, `retrieve_work_item_by_identifier`,
      `retrieve_project` return the documented default field set by
      default, with their long-text field truncated at
      `DEFAULT_MAX_DESCRIPTION_CHARS` and a truncation marker appended
      only when actually truncated
- [ ] `max_description_chars`, `fields`, `full` all independently verified
      by test to change behavior as specified
- [ ] `fields=` verified (via query-param assertion, not just response
      shape) to be pushed down to Plane for all three tools by default
- [ ] `docs/plans/TRACK.md` updated: Phase 20 row `[~]` at start, `[x]` at
      completion

## Open questions

- None — `WorkItem`/`Project`'s wire shapes are fully documented in
  `docs/plane-api-reference.md` §7.1/§7.2 (unlike Phase 19's Member
  open question), so every field named in this phase's default sets is
  verified against the reference doc, not guessed.
