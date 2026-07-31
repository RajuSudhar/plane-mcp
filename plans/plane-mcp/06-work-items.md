# feat-work-items

Phase: 06 | Status: [ ] planned
Depends on: 05-tools-foundation
Ref: `plans/plane-mcp/00-rfc.md`, `../../../docs/plane-api-reference.md` §3.5, §5.5, §6.4, §7.1

## Goal

Implement the full work-item tool set: `list_work_items` (all filters +
pagination), `retrieve_work_item`, `retrieve_work_item_by_identifier`,
`create_work_item`, `update_work_item`, `delete_work_item`,
`search_work_items` — with correct field-name normalization on every write.

## In scope

- `src/tools/work-items.ts` — all seven work-item tools.
- Zod schemas for each, matching the filter/argument surface in spec report
  §6.4.
- Use of `toWorkItemWriteBody` (Phase 04) for `create_work_item` and
  `update_work_item`.
- Unit tests for all seven tools against a mocked `PlaneClient`, including
  the `ENG-42`-style identifier path.
- Update `src/server.ts` to register `registerWorkItemTools`.

## Out of scope

- Comments, relations (Phase 07).
- States, labels (Phase 08) — `list_work_items`' `state_ids`/`label_ids`
  filters accept raw UUID strings from the caller; this phase does not
  resolve human-readable state/label names to UUIDs (the model is expected
  to call `list_states`/`list_labels` itself, per spec report §10 workflow
  examples).
- Work item comments/relations/activities/worklogs/attachments/links (all
  out of RFC scope except comments+relations, which are Phase 07).

## Design

### Endpoint map (spec report §3.5, §6.4)

| Tool                               | Method | Path                                                                              |
| ---------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `list_work_items`                  | GET    | `projects/{project_id}/work-items/`                                               |
| `retrieve_work_item`               | GET    | `projects/{project_id}/work-items/{work_item_id}/`                                |
| `retrieve_work_item_by_identifier` | GET    | `projects/{project_id}/work-items/identifier/{project_identifier}-{sequence_id}/` |
| `create_work_item`                 | POST   | `projects/{project_id}/work-items/`                                               |
| `update_work_item`                 | PATCH  | `projects/{project_id}/work-items/{work_item_id}/`                                |
| `delete_work_item`                 | DELETE | `projects/{project_id}/work-items/{work_item_id}/`                                |
| `search_work_items`                | GET    | `projects/{project_id}/work-items/search/?q=…`                                    |

All paths are relative to `client.workspacePath(...)`.

**IMPORTANT — `retrieve_work_item_by_identifier` still needs `project_id`,
not just `project_identifier`**: the URL path in spec report §3.5 is
`.../projects/{project_id}/work-items/identifier/{project_identifier}-
{sequence_id}/` — it is scoped by the project's UUID _and_ carries the
human-readable identifier + sequence number in the same request. The tool's
required args are therefore `project_id` (UUID) **and**
`project_identifier` + `work_item_identifier` (the human-readable pieces),
matching spec report §5.5/§6.4 exactly — do not assume `project_identifier`
alone is sufficient to resolve the URL; the caller (model) is expected to
already have `project_id` from a prior `list_projects`/`retrieve_project`
call, exactly as shown in spec report §10's "Look up by human-readable ID"
workflow, which just says `retrieve_work_item_by_identifier(project_identifier="ENG",
work_item_identifier="42")` — reconcile this by defaulting to requiring
`project_id` per the exact URL shape in §3.5, since §10 is a
simplified example, not the literal tool signature. See Open Questions.

### Zod schemas

```typescript
import { z } from 'zod';

const priority = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
const stateGroup = z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']);

const listWorkItemsSchema = z.object({
  project_id: z.string(),
  query: z.string().optional(),
  assignee_ids: z.array(z.string()).optional(),
  state_ids: z.array(z.string()).optional(),
  state_groups: z.array(stateGroup).optional(),
  priorities: z.array(priority).optional(),
  label_ids: z.array(z.string()).optional(),
  cycle_ids: z.array(z.string()).optional(),
  module_ids: z.array(z.string()).optional(),
  cursor: z.string().optional(),
  per_page: z.number().int().min(1).max(100).optional(),
  fields: z.string().optional(),
  expand: z.string().optional(),
});

const retrieveWorkItemSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  fields: z.string().optional(),
  expand: z.string().optional(),
});

const retrieveWorkItemByIdentifierSchema = z.object({
  project_id: z.string(),
  project_identifier: z.string(),
  work_item_identifier: z.string(),
});

const createWorkItemSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  description_html: z.string().optional(),
  priority: priority.optional(),
  state_id: z.string().optional(),
  assignee_ids: z.array(z.string()).optional(),
  label_ids: z.array(z.string()).optional(),
  type_id: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  estimate_point: z.string().optional(),
  external_id: z.string().optional(),
  external_source: z.string().optional(),
});

const updateWorkItemSchema = createWorkItemSchema.omit({ project_id: true, name: true }).extend({
  project_id: z.string(),
  work_item_id: z.string(),
  name: z.string().optional(),
});

const deleteWorkItemSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
});

const searchWorkItemsSchema = z.object({
  project_id: z.string(),
  query: z.string(),
});
```

**Note on tool-arg naming vs write-body naming**: tool args use the
read-shape-friendly names (`state_id`, `assignee_ids`, `due_date`) — matching
what the model sees when it reads back a `WorkItem` — while
`toWorkItemWriteBody` (Phase 04) translates these into the write-shape body
Plane expects (`state`, `assignees`, `target_date`) at the point of the
actual POST/PATCH call. This is the one and only place normalization
happens; `list_work_items`' `state_ids`/`label_ids` filters are query
params, not write-body fields, so they pass through unchanged (Plane's GET
filters use the plural `_ids` names natively — no asymmetry on the read
side).

### `src/tools/work-items.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { PaginationEnvelope, WorkItem } from '@types/plane';
import { toolHandler } from './register';
import { toWorkItemWriteBody } from '../plane/normalize';

// ... schemas from Design section above ...

export function registerWorkItemTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_work_items',
    {
      description: 'List work items in a project, with optional filters. Returns the raw pagination envelope.',
      inputSchema: listWorkItemsSchema,
    },
    toolHandler('list_work_items', client, async (c, args) => {
      const { project_id, ...query } = args;
      const envelope = await c.get<PaginationEnvelope<WorkItem>>(
        c.workspacePath(`projects/${project_id}/work-items/`),
        query as Record<string, string | number | boolean | undefined>
      );
      return { content: [{ type: 'text', text: JSON.stringify(envelope) }], structuredContent: envelope };
    })
  );

  server.registerTool(
    'retrieve_work_item',
    {
      description: 'Retrieve a single work item by project UUID and work item UUID.',
      inputSchema: retrieveWorkItemSchema,
    },
    toolHandler('retrieve_work_item', client, async (c, args) => {
      const { project_id, work_item_id, ...query } = args;
      const item = await c.get<WorkItem>(c.workspacePath(`projects/${project_id}/work-items/${work_item_id}/`), query);
      return { content: [{ type: 'text', text: JSON.stringify(item) }], structuredContent: item };
    })
  );

  server.registerTool(
    'retrieve_work_item_by_identifier',
    {
      description:
        'Retrieve a work item by its human-readable identifier, e.g. project_identifier="ENG", work_item_identifier="42".',
      inputSchema: retrieveWorkItemByIdentifierSchema,
    },
    toolHandler('retrieve_work_item_by_identifier', client, async (c, args) => {
      const item = await c.get<WorkItem>(
        c.workspacePath(
          `projects/${args.project_id}/work-items/identifier/${args.project_identifier}-${args.work_item_identifier}/`
        )
      );
      return { content: [{ type: 'text', text: JSON.stringify(item) }], structuredContent: item };
    })
  );

  server.registerTool(
    'create_work_item',
    {
      description: 'Create a new work item in a project.',
      inputSchema: createWorkItemSchema,
    },
    toolHandler('create_work_item', client, async (c, args) => {
      const { project_id, ...rest } = args;
      const body = toWorkItemWriteBody({
        name: rest.name,
        descriptionHtml: rest.description_html,
        priority: rest.priority,
        stateId: rest.state_id,
        assigneeIds: rest.assignee_ids,
        labelIds: rest.label_ids,
        typeId: rest.type_id,
        parentId: rest.parent_id,
        startDate: rest.start_date,
        dueDate: rest.due_date,
        estimatePoint: rest.estimate_point,
        externalId: rest.external_id,
        externalSource: rest.external_source,
      });
      const item = await c.post<WorkItem>(c.workspacePath(`projects/${project_id}/work-items/`), body);
      return { content: [{ type: 'text', text: JSON.stringify(item) }], structuredContent: item };
    })
  );

  server.registerTool(
    'update_work_item',
    {
      description: 'Update fields on an existing work item (partial update).',
      inputSchema: updateWorkItemSchema,
    },
    toolHandler('update_work_item', client, async (c, args) => {
      const { project_id, work_item_id, ...rest } = args;
      const body = toWorkItemWriteBody({
        name: rest.name,
        descriptionHtml: rest.description_html,
        priority: rest.priority,
        stateId: rest.state_id,
        assigneeIds: rest.assignee_ids,
        labelIds: rest.label_ids,
        typeId: rest.type_id,
        parentId: rest.parent_id,
        startDate: rest.start_date,
        dueDate: rest.due_date,
        estimatePoint: rest.estimate_point,
        externalId: rest.external_id,
        externalSource: rest.external_source,
      });
      const item = await c.patch<WorkItem>(c.workspacePath(`projects/${project_id}/work-items/${work_item_id}/`), body);
      return { content: [{ type: 'text', text: JSON.stringify(item) }], structuredContent: item };
    })
  );

  server.registerTool(
    'delete_work_item',
    {
      description: 'Delete a work item.',
      inputSchema: deleteWorkItemSchema,
    },
    toolHandler('delete_work_item', client, async (c, args) => {
      await c.delete(c.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/`));
      return { content: [{ type: 'text', text: 'deleted' }] };
    })
  );

  server.registerTool(
    'search_work_items',
    {
      description: 'Full-text search of work items within a project.',
      inputSchema: searchWorkItemsSchema,
    },
    toolHandler('search_work_items', client, async (c, args) => {
      const results = await c.get(c.workspacePath(`projects/${args.project_id}/work-items/search/`), {
        q: args.query,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(results) }],
        structuredContent: results as Record<string, unknown>,
      };
    })
  );
}
```

**IMPORTANT**: `search_work_items` maps the tool arg `query` to the wire
query param `q` (spec report §3.5: `?q=…`) — this is a second, narrower
instance of name normalization beyond the work-item write body, called out
explicitly so it isn't missed during implementation.

## Tasks

- [ ] Write all 7 zod schemas in `src/tools/work-items.ts` (or a co-located
      `src/tools/work-items.schemas.ts` if the file grows unwieldy — file
      split is an implementation choice, not a design requirement)
- [ ] Implement `registerWorkItemTools` with all 7 tools per Design
- [ ] Wire `registerWorkItemTools(server, client)` into `src/server.ts`
- [ ] Write `src/tools/work-items.test.ts` covering:
  - [ ] `list_work_items` passes all filter args through as query params
        untouched (no client-side filtering/re-shaping)
  - [ ] `retrieve_work_item` builds the correct UUID-based path
  - [ ] `retrieve_work_item_by_identifier` builds the correct
        `identifier/{project_identifier}-{work_item_identifier}/` path (the
        `ENG-42` path) and returns the full record including its UUID
  - [ ] `create_work_item` calls `toWorkItemWriteBody` correctly — assert
        the body sent to `client.post` has `state` (not `state_id`),
        `assignees` (not `assignee_ids`), `target_date` (not `due_date`)
  - [ ] `update_work_item` — same normalization assertion as create, for a
        partial update (e.g. only `priority` changed)
  - [ ] `delete_work_item` calls `client.delete` with the correct path
  - [ ] `search_work_items` maps `query` -> `q` query param
  - [ ] Error path: at least one tool's mocked client throws
        `PlaneApiError`, assert `isError: true`
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes

## Definition of done

- [ ] All 7 work-item tools registered and callable
- [ ] Each tool unit-tested per the Tasks checklist above (mocked
      `PlaneClient`)
- [ ] Field normalization verified by explicit assertions on the request
      body sent to `client.post`/`client.patch`, not just "response looks
      right"
- [ ] `docs/plans/TRACK.md` updated: Phase 06 row `[~]` at start, `[x]` at
      completion

## Open questions

- **`retrieve_work_item_by_identifier` signature**: spec report §5.5/§6.4
  imply the tool only needs `project_identifier` + `work_item_identifier`
  (e.g. `"ENG"` + `"42"`), but the literal endpoint path in §3.5 is scoped
  under `{project_id}` (UUID), not `{project_identifier}`. This plan
  requires all three args (`project_id`, `project_identifier`,
  `work_item_identifier`) to match the literal endpoint shape exactly,
  accepting that the model must already hold `project_id` (from a prior
  `list_projects` call) before calling this tool — resolve definitively by
  testing the real endpoint against a live/sandboxed Plane instance during
  this phase; if Plane in practice accepts `{project_identifier}` directly
  in place of `{project_id}` in that URL segment, simplify the tool
  signature to drop the redundant `project_id` arg and update this file.
- Whether `list_work_items` should require `project_id` unconditionally (as
  modeled above) or support the workspace-wide advanced search variant
  (`GET /api/v1/workspaces/{slug}/work-items/search/` from spec report
  §3.5, distinct from the project-scoped list) is out of scope for this
  phase — the RFC's tool list has a single `list_work_items`, scoped to one
  project at a time, matching the project-scoped endpoint. Cross-project
  listing (`workspace_search=true` in spec report §6.4's optional args) is
  not implemented; do not add it without a plan update.
