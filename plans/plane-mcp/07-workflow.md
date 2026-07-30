# feat-workflow

Phase: 07  |  Status: [ ] planned
Depends on: 06-collaboration
Ref: `plans/plane-mcp/00-rfc.md`, `../../../docs/plane-api-reference.md` §3.2, §3.4, §3.6, §6.12, §6.13, §6.2, §6.3

## Goal

Implement states (list/create), labels (list/create), and member listing
(`get_project_members`, `get_workspace_members`).

## In scope

- `src/tools/states.ts` — `list_states`, `create_state`.
- `src/tools/labels.ts` — `list_labels`, `create_label`.
- `src/tools/members.ts` — `get_project_members`, `get_workspace_members`.
- Zod schemas incl. `group` (state group) enum validation.
- Unit tests for all 6 tools against a mocked `PlaneClient`.
- Update `src/server.ts` to register all three new modules.

## Out of scope

- `retrieve_state`/`update_state`/`delete_state` — not in the locked ~25
  tool list (only `list_states` + `create_state`).
- `retrieve_label`/`update_label`/`delete_label` — same reasoning.
- Workspace/project member write operations (invite, role change, remove) —
  read-only member tools only, per the locked tool list.

## Design

### Endpoint map

| Tool | Method | Path |
| --- | --- | --- |
| `list_states` | GET | `projects/{project_id}/states/` |
| `create_state` | POST | `projects/{project_id}/states/` |
| `list_labels` | GET | `projects/{project_id}/labels/` |
| `create_label` | POST | `projects/{project_id}/labels/` |
| `get_project_members` | GET | `projects/{project_id}/members/` |
| `get_workspace_members` | GET | `members/` |

`get_workspace_members`'s path (`members/`) is workspace-scoped —
`client.workspacePath('members/')` resolves to
`/api/v1/workspaces/{slug}/members/`, matching spec report §3.1.

### Zod schemas

```typescript
import { z } from 'zod';

const stateGroup = z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']);
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color must be a #RRGGBB hex string');

const listStatesSchema = z.object({ project_id: z.string() });

const createStateSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  color: hexColor,
  group: stateGroup,
  description: z.string().optional(),
});

const listLabelsSchema = z.object({ project_id: z.string() });

const createLabelSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  color: hexColor,
  parent: z.string().nullable().optional(),
});

const getProjectMembersSchema = z.object({ project_id: z.string() });

const getWorkspaceMembersSchema = z.object({});
```

**IMPORTANT**: `group` is validated as a closed enum
(`backlog|unstarted|started|completed|cancelled`, spec report §7.4) — this
is the same vocabulary `list_work_items`' `state_groups` filter uses
(Phase 05); do not diverge the two enum definitions. If a shared constant is
preferable to redeclaring the `z.enum` array in two files, add a small
shared schema module (e.g. `src/tools/shared-schemas.ts`) in this phase and
have Phase 05's `work-items.ts` import it too — this is an allowed
refactor of Phase 05 code as long as behavior is unchanged (no interface
or endpoint change, purely a schema-source dedup).

### `src/tools/states.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { State } from '@types/plane';
import { toolHandler } from './register';

// ... schemas ...

export function registerStateTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_states',
    { description: 'List workflow states for a project.', inputSchema: listStatesSchema },
    toolHandler('list_states', client, async (c, args) => {
      const states = await c.get<State[]>(c.workspacePath(`projects/${args.project_id}/states/`));
      return { content: [{ type: 'text', text: JSON.stringify(states) }], structuredContent: { states } };
    }),
  );

  server.registerTool(
    'create_state',
    { description: 'Create a new workflow state in a project.', inputSchema: createStateSchema },
    toolHandler('create_state', client, async (c, args) => {
      const { project_id, ...body } = args;
      const state = await c.post<State>(c.workspacePath(`projects/${project_id}/states/`), body);
      return { content: [{ type: 'text', text: JSON.stringify(state) }], structuredContent: state };
    }),
  );
}
```

### `src/tools/labels.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { Label } from '@types/plane';
import { toolHandler } from './register';

// ... schemas ...

export function registerLabelTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_labels',
    { description: 'List labels for a project.', inputSchema: listLabelsSchema },
    toolHandler('list_labels', client, async (c, args) => {
      const labels = await c.get<Label[]>(c.workspacePath(`projects/${args.project_id}/labels/`));
      return { content: [{ type: 'text', text: JSON.stringify(labels) }], structuredContent: { labels } };
    }),
  );

  server.registerTool(
    'create_label',
    { description: 'Create a new label in a project.', inputSchema: createLabelSchema },
    toolHandler('create_label', client, async (c, args) => {
      const { project_id, ...body } = args;
      const label = await c.post<Label>(c.workspacePath(`projects/${project_id}/labels/`), body);
      return { content: [{ type: 'text', text: JSON.stringify(label) }], structuredContent: label };
    }),
  );
}
```

### `src/tools/members.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { Member } from '@types/plane';
import { toolHandler } from './register';

// ... schemas ...

export function registerMemberTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'get_project_members',
    { description: 'List members of a project.', inputSchema: getProjectMembersSchema },
    toolHandler('get_project_members', client, async (c, args) => {
      const members = await c.get<Member[]>(c.workspacePath(`projects/${args.project_id}/members/`));
      return { content: [{ type: 'text', text: JSON.stringify(members) }], structuredContent: { members } };
    }),
  );

  server.registerTool(
    'get_workspace_members',
    { description: 'List members of the configured workspace.', inputSchema: getWorkspaceMembersSchema },
    toolHandler('get_workspace_members', client, async (c) => {
      const members = await c.get<Member[]>(c.workspacePath('members/'));
      return { content: [{ type: 'text', text: JSON.stringify(members) }], structuredContent: { members } };
    }),
  );
}
```

## Tasks

- [ ] Write zod schemas for states/labels/members per Design
- [ ] Implement `registerStateTools` (2 tools)
- [ ] Implement `registerLabelTools` (2 tools)
- [ ] Implement `registerMemberTools` (2 tools)
- [ ] Wire all three into `src/server.ts`
- [ ] Write `src/tools/states.test.ts` incl. a test asserting an invalid
      `group` value (e.g. `"done"`, not in the enum) is rejected before any
      client call
- [ ] Write `src/tools/labels.test.ts` incl. a test asserting an invalid
      `color` (not `#RRGGBB`) is rejected before any client call
- [ ] Write `src/tools/members.test.ts` — success + error path for both
      tools
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes

## Definition of done

- [ ] All 6 tools registered and callable
- [ ] `group` enum and `color` hex-format validated at the zod layer
- [ ] `docs/plans/TRACK.md` updated: Phase 07 row `[~]` at start, `[x]` at
      completion

## Open questions

- None — endpoint shapes and field vocabularies for this phase are fully
  specified in the spec report with no ambiguity.
