# feat-context-docs

Phase: 21 | Status: [ ] todo
Depends on: 18-work-item-endpoints, 19-list-projections, 20-retrieve-shaping
Ref: `plans/plane-mcp/00-rfc.md` (Proposed design amendment, 2026-08-15), `plans/plane-mcp/17-response-shaping.md` through `20-retrieve-shaping.md`

## Goal

Make the new default-projection behavior, and the Phase 18 correctness fix
(client-side filtering/search, module/cycle-scoped listing, the scan page
cap), discoverable to the calling model (tool `description` strings) and to
a human reader (`README.md`, `docs/CODING-STANDARDS.md`, `CLAUDE.md`). No
runtime behavior changes in this phase — documentation and
description-string text only.

**Renumbered from the original Phase 20**, with Phase 18's documentation
obligations folded in per the amendment: the earlier draft only covered
Phases 18-19 (now 19-20)'s projection/truncation behavior. `list_work_items`
and `search_work_items` now also have a materially different filtering/
search contract (client-side, module/cycle real sub-endpoints, a bounded
scan with a possible `truncated: true`) that the model needs surfaced in
its tool description the same way — an agent calling `list_work_items`
with `state_ids` and silently getting back an unfiltered page (today's bug)
or a `truncated: true` result it never checks is exactly the failure mode
this phase exists to prevent.

## In scope

- Update the `description` string of all 15 tools touched by Phases
  18-20 (`list_projects`, `list_work_items`, `search_work_items`,
  `list_work_item_comments`, `get_project_members`,
  `get_workspace_members`, `list_states`, `list_labels`, `list_cycles`,
  `list_modules`, `retrieve_work_item`, `retrieve_work_item_by_identifier`,
  `retrieve_project`, plus `list_work_items`/`search_work_items`
  themselves getting a second, Phase-18-specific addition — see Design) to
  state the default field set and name the `fields`/`full`
  (/`max_description_chars`) escape hatches, so the model knows to reach
  for them without needing a failed call first.
- `list_work_items`'s `description` additionally states: `module_id`/
  `cycle_id` route to the real per-module/per-cycle listing endpoint;
  `state_ids`/`state_groups`/`priorities`/`assignee_ids`/`label_ids` are
  applied client-side (Plane's public API does not support them as query
  filters) over up to `CLIENT_SIDE_SCAN_MAX_ITEMS` scanned items; a
  `truncated: true` response field means more matches may exist beyond the
  scan cap.
- `search_work_items`'s `description` additionally states: search is a
  client-side, case-insensitive scan of `name`/`sequence_id` over up to
  `CLIENT_SIDE_SCAN_MAX_ITEMS` items (not Plane's native search, which
  requires Pro-tier OpenSearch and 404s on Community), and the same
  `truncated` semantics apply.
- `README.md` — a new short section describing the default-projection
  behavior at the tool-catalog level (one paragraph + one example of
  overriding via `fields`), plus a second short section covering
  `list_work_items`/`search_work_items`'s client-side filtering/search
  behavior and the scan cap, cross-referencing
  `plans/plane-mcp/18-work-item-endpoints.md`.
- `docs/CODING-STANDARDS.md` — a new subsection under the existing
  tool-authoring guidance documenting the `ProjectionSpec`/`projectItem`/
  `projectList` pattern as the required approach for any future tool
  returning a Plane resource, so it is not silently reinvented per-tool
  the way the pre-Phase-17 code was.
- `CLAUDE.md` routing table — add a row pointing "response shape / field
  projection / truncation" changes at
  `plans/plane-mcp/17-response-shaping.md`, and a second row pointing
  "work item list/search filtering, module/cycle-scoped listing, the
  client-side scan cap" at `plans/plane-mcp/18-work-item-endpoints.md`.

## Out of scope

- Any further tool logic change — this phase touches only string
  literals (`description` values) and markdown files.
- `docs/plane-api-reference.md` — that file documents Plane's own API,
  not this server's tool-response shaping or its two Phase-18 endpoint
  workarounds; not touched. (It is also the document whose two inaccurate
  claims — §2.6's implied filter-param support, and the `/search/` path
  at line 243 — motivated Phase 18 in the first place; correcting it is
  a separate concern from documenting this server's tools.)

## Design

### Description string pattern

Each touched tool's `description` gains one trailing sentence in a
consistent template, so the pattern is scannable across the tool list
rather than bespoke phrasings per tool:

- List/bulk tools: `"... Returns a reduced default field set per item
(<field names>); pass fields to add specific raw fields, or full: true
for the complete object."`
- Retrieve tools: `"... Returns a reduced default field set
(<field names>) with <field> capped at <N> characters; pass fields to
add specific raw fields, max_description_chars to change the cap, or
full: true for the complete untruncated object."`

Example (`list_projects`, replacing the current one-line description in
`src/tools/projects.ts`):

```typescript
description:
  'List projects in the configured workspace. Returns a reduced default ' +
  "field set per item (id, name, identifier); pass fields to add specific " +
  "raw fields, or full: true for the complete object. Pagination metadata " +
  '(next_cursor, count, total_results, etc.) is always returned in full.',
```

Example (`retrieve_work_item`):

```typescript
description:
  'Retrieve a single work item by its UUID. Returns a reduced default ' +
  'field set (id, name, sequence_id, description_html, priority, ' +
  'state_id, type_id, parent_id, project_id, assignee_ids, label_ids, ' +
  'start_date, target_date, completed_at, created_at, updated_at, ' +
  'created_by_id) with description_html capped at 2000 characters by ' +
  'default; pass fields to add specific raw fields, ' +
  'max_description_chars to change the cap, or full: true for the ' +
  'complete untruncated object.',
```

Every other of the 13 Phase-19/20 tools follows the same template with its
own documented field list substituted in.

### `list_work_items`/`search_work_items` — Phase 18 addition

These two tools' descriptions carry both the projection sentence above
_and_ a filtering/search-contract sentence:

```typescript
// list_work_items
description:
  'List work items in a project. Returns a reduced default field set per ' +
  'item (id, sequence_id, name, state_id, priority, assignee_ids); pass ' +
  'fields to add specific raw fields, or full: true for the complete ' +
  'object. module_id/cycle_id route to the real per-module/per-cycle ' +
  'listing endpoint. state_ids, state_groups, priorities, assignee_ids, ' +
  'and label_ids are applied client-side over up to 500 scanned items ' +
  "(Plane's public API does not support them as server-side filters); " +
  'a truncated: true field in the response means more matches may exist ' +
  'beyond the scan.',
```

```typescript
// search_work_items
description:
  'Search for work items in a project by name or ticket number. This is ' +
  "a client-side, case-insensitive scan (not Plane's native search, " +
  'which requires a Pro-tier feature unavailable on self-hosted ' +
  'Community) over up to 500 scanned items; a truncated: true field in ' +
  'the response means more matches may exist beyond the scan. Returns a ' +
  'reduced default field set per item (id, sequence_id, name, state_id, ' +
  'priority, assignee_ids); pass fields to add specific raw fields, or ' +
  'full: true for the complete object.',
```

The literal `500` is `CLIENT_SIDE_SCAN_MAX_ITEMS` (`src/tools/constants.ts`,
Phase 18) — if that constant's value changes in a future phase, these two
description strings are stale until updated; there is no automated
cross-check between a `description` string literal and the constant it
names (same limitation the field-list descriptions above already have
relative to `ProjectionSpec.defaultFields`).

### `README.md` addition

Two new subsections (placed near the existing tool-catalog / usage section
— exact heading location confirmed against the current `README.md` at
implementation time, not fixed here):

1. Default-projection behavior:
   - One paragraph: by default, list and retrieve tools return a reduced
     per-resource field set instead of Plane's full raw object, to keep
     agent context small; envelope/pagination metadata is never reduced.
   - One short example: a `list_work_items` call with
     `fields: ["description_html"]` merging in the description alongside
     the defaults, contrasted with `full: true` returning everything.
   - A one-line pointer to `plans/plane-mcp/17-response-shaping.md` for
     the full per-tool default field tables (Phases 19-20), so the README
     stays short and the phase docs remain the source of truth.
2. `list_work_items`/`search_work_items` filtering and search:
   - One paragraph: Plane's public REST API does not support most array
     filters or native search on self-hosted Community; this server
     applies `state_ids`/`state_groups`/`priorities`/`assignee_ids`/
     `label_ids` filtering and all of `search_work_items`'s matching
     client-side, over a bounded scan (currently 500 items), and routes
     `module_id`/`cycle_id` to Plane's real per-module/per-cycle listing
     endpoints instead.
   - One short example: a `list_work_items` call with
     `state_ids: [...]` and a note to check the response's `truncated`
     field.
   - A one-line pointer to `plans/plane-mcp/18-work-item-endpoints.md`.

### `docs/CODING-STANDARDS.md` addition

A new subsection under whatever existing heading covers tool
implementation conventions, stating as a hard pattern (not a suggestion):
any tool returning a Plane resource (list, bulk, or retrieve) must define
a `ProjectionSpec<T>` and route its response through
`projectItem`/`projectList` from `src/plane/select.ts` rather than
`JSON.stringify`-ing the raw client response directly — the exact
anti-pattern Phase 17's Problem section identified. Cross-reference
`plans/plane-mcp/17-response-shaping.md`.

## Tasks

- [ ] Update all 15 tool `description` strings per the templates above (10
      in the files touched by Phase 19, 3 in the files touched by Phase 20,
      plus the 2 Phase-18-specific additions to `list_work_items`/
      `search_work_items` — no new files, description edits only)
- [ ] Add the `README.md` default-projection subsection
- [ ] Add the `README.md` filtering/search subsection
- [ ] Add the `docs/CODING-STANDARDS.md` subsection
- [ ] Add both `CLAUDE.md` routing table rows (Phase 17 projection row,
      Phase 18 filtering/search row)
- [ ] Run `bun run format:check` — passes (markdown + ts formatting)
- [ ] Run `bun test` — all green (existing tests may assert on exact
      `description` string equality; update any that do rather than
      leaving them stale — grep every touched tool's test file for a
      `description` assertion before considering this task done)
- [ ] Run `bun run typecheck` — passes

## Definition of done

- [ ] All 15 tools' `description` strings name their default field set
      and every escape-hatch param they support; `list_work_items`/
      `search_work_items` additionally name their client-side filtering/
      search contract and the scan cap
- [ ] `README.md`, `docs/CODING-STANDARDS.md`, `CLAUDE.md` all updated and
      cross-reference `plans/plane-mcp/17-response-shaping.md` and
      `plans/plane-mcp/18-work-item-endpoints.md` as appropriate
- [ ] No tool logic, schema, or test assertion outside of stale
      `description`-string checks changes in this phase
- [ ] `docs/plans/TRACK.md` updated: Phase 21 row `[~]` at start, `[x]` at
      completion; feature marked complete in the Decisions/deviations log
      (one consolidated entry summarizing Phases 17-21, matching the
      style of existing entries 7-12)

## Open questions

- None.
