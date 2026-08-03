# feat-sprints

Phase: 09 | Status: [x] done
Depends on: 08-workflow
Ref: `plans/plane-mcp/00-rfc.md`, `../../../docs/plane-api-reference.md` §3.11, §3.12, §6.14, §6.15

## Goal

Implement cycles (sprints) and modules: list/create for each, plus the
work-item many-to-many join/unjoin tools.

## In scope

- `src/tools/cycles.ts` — `list_cycles`, `create_cycle`,
  `add_work_items_to_cycle`, `remove_work_item_from_cycle`.
- `src/tools/modules.ts` — `list_modules`, `create_module`,
  `add_work_items_to_module`, `remove_work_item_from_module`.
- Unit tests for all 8 tools against a mocked `PlaneClient`, with explicit
  assertions on the many-to-many add/remove request bodies.
- Update `src/server.ts` to register both new modules.

## Out of scope

- `retrieve_cycle`/`update_cycle`/`delete_cycle`/`archive_cycle`/
  `unarchive_cycle`/`transfer_cycle_work_items`/`list_cycle_work_items` —
  not in the locked ~25 tool list.
- `retrieve_module`/`update_module`/`delete_module`/`archive_module`/
  `unarchive_module`/`list_module_work_items` — same reasoning.

## Design

### Endpoint map

| Tool                           | Method | Path                                                                   |
| ------------------------------ | ------ | ---------------------------------------------------------------------- |
| `list_cycles`                  | GET    | `projects/{project_id}/cycles/`                                        |
| `create_cycle`                 | POST   | `projects/{project_id}/cycles/`                                        |
| `add_work_items_to_cycle`      | POST   | `projects/{project_id}/cycles/{cycle_id}/work-items/`                  |
| `remove_work_item_from_cycle`  | DELETE | `projects/{project_id}/cycles/{cycle_id}/work-items/{work_item_id}/`   |
| `list_modules`                 | GET    | `projects/{project_id}/modules/`                                       |
| `create_module`                | POST   | `projects/{project_id}/modules/`                                       |
| `add_work_items_to_module`     | POST   | `projects/{project_id}/modules/{module_id}/work-items/`                |
| `remove_work_item_from_module` | DELETE | `projects/{project_id}/modules/{module_id}/work-items/{work_item_id}/` |

### Zod schemas

```typescript
import { z } from 'zod';

const listCyclesSchema = z.object({ project_id: z.string() });

const createCycleSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

const addWorkItemsToCycleSchema = z.object({
  project_id: z.string(),
  cycle_id: z.string(),
  work_item_ids: z.array(z.string()).min(1),
});

const removeWorkItemFromCycleSchema = z.object({
  project_id: z.string(),
  cycle_id: z.string(),
  work_item_id: z.string(),
});

const listModulesSchema = z.object({ project_id: z.string() });

const createModuleSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  lead: z.string().optional(),
  members: z.array(z.string()).optional(),
});

const addWorkItemsToModuleSchema = z.object({
  project_id: z.string(),
  module_id: z.string(),
  work_item_ids: z.array(z.string()).min(1),
});

const removeWorkItemFromModuleSchema = z.object({
  project_id: z.string(),
  module_id: z.string(),
  work_item_id: z.string(),
});
```

**Note**: `create_cycle` uses `start_date`/`end_date` (spec report §7.3,
Cycle's wire shape) while `create_module` uses `start_date`/`target_date`
(spec report §6.15) — these are genuinely different field names between the
two resources on Plane's side, not a normalization bug to "fix"; both are
passed straight through with no renaming.

### `src/tools/cycles.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { Cycle } from '@types/plane';
import { toolHandler } from './register';

// ... schemas ...

export function registerCycleTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_cycles',
    { description: 'List cycles (sprints) for a project.', inputSchema: listCyclesSchema },
    toolHandler('list_cycles', client, async (c, args) => {
      const cycles = await c.get<Cycle[]>(c.workspacePath(`projects/${args.project_id}/cycles/`));
      return { content: [{ type: 'text', text: JSON.stringify(cycles) }], structuredContent: { cycles } };
    })
  );

  server.registerTool(
    'create_cycle',
    { description: 'Create a new cycle (sprint) in a project.', inputSchema: createCycleSchema },
    toolHandler('create_cycle', client, async (c, args) => {
      const { project_id, ...body } = args;
      const cycle = await c.post<Cycle>(c.workspacePath(`projects/${project_id}/cycles/`), body);
      return { content: [{ type: 'text', text: JSON.stringify(cycle) }], structuredContent: cycle };
    })
  );

  server.registerTool(
    'add_work_items_to_cycle',
    { description: 'Add one or more work items to a cycle.', inputSchema: addWorkItemsToCycleSchema },
    toolHandler('add_work_items_to_cycle', client, async (c, args) => {
      const result = await c.post(c.workspacePath(`projects/${args.project_id}/cycles/${args.cycle_id}/work-items/`), {
        work_item_ids: args.work_item_ids,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    })
  );

  server.registerTool(
    'remove_work_item_from_cycle',
    { description: 'Remove a single work item from a cycle.', inputSchema: removeWorkItemFromCycleSchema },
    toolHandler('remove_work_item_from_cycle', client, async (c, args) => {
      await c.delete(
        c.workspacePath(`projects/${args.project_id}/cycles/${args.cycle_id}/work-items/${args.work_item_id}/`)
      );
      return { content: [{ type: 'text', text: 'removed' }] };
    })
  );
}
```

### `src/tools/modules.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { Module } from '@types/plane';
import { toolHandler } from './register';

// ... schemas ...

export function registerModuleTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_modules',
    { description: 'List modules for a project.', inputSchema: listModulesSchema },
    toolHandler('list_modules', client, async (c, args) => {
      const modules = await c.get<Module[]>(c.workspacePath(`projects/${args.project_id}/modules/`));
      return { content: [{ type: 'text', text: JSON.stringify(modules) }], structuredContent: { modules } };
    })
  );

  server.registerTool(
    'create_module',
    { description: 'Create a new module in a project.', inputSchema: createModuleSchema },
    toolHandler('create_module', client, async (c, args) => {
      const { project_id, ...body } = args;
      const module_ = await c.post<Module>(c.workspacePath(`projects/${project_id}/modules/`), body);
      return { content: [{ type: 'text', text: JSON.stringify(module_) }], structuredContent: module_ };
    })
  );

  server.registerTool(
    'add_work_items_to_module',
    { description: 'Add one or more work items to a module.', inputSchema: addWorkItemsToModuleSchema },
    toolHandler('add_work_items_to_module', client, async (c, args) => {
      const result = await c.post(
        c.workspacePath(`projects/${args.project_id}/modules/${args.module_id}/work-items/`),
        { work_item_ids: args.work_item_ids }
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    })
  );

  server.registerTool(
    'remove_work_item_from_module',
    { description: 'Remove a single work item from a module.', inputSchema: removeWorkItemFromModuleSchema },
    toolHandler('remove_work_item_from_module', client, async (c, args) => {
      await c.delete(
        c.workspacePath(`projects/${args.project_id}/modules/${args.module_id}/work-items/${args.work_item_id}/`)
      );
      return { content: [{ type: 'text', text: 'removed' }] };
    })
  );
}
```

## Tasks

- [x] Write zod schemas for cycles/modules per Design
- [x] Implement `registerCycleTools` (4 tools)
- [x] Implement `registerModuleTools` (4 tools)
- [x] Wire both into `src/server.ts`
- [x] Write `src/tools/cycles.test.ts`:
  - [x] `add_work_items_to_cycle` asserts the body sent to `client.post` is
        exactly `{ work_item_ids: [...] }`, not a differently-shaped body
  - [x] `remove_work_item_from_cycle` asserts the DELETE path includes the
        single `work_item_id` segment
  - [x] `work_item_ids: []` (empty array) rejected by zod's `.min(1)` before
        any client call
- [x] Write `src/tools/modules.test.ts` — same coverage shape, module-scoped
- [x] Run `bun test` — all green
- [x] Run `bun run typecheck` — passes

## Definition of done

- [x] All 8 tools (4 cycle + 4 module) registered and callable
- [x] m2m add-body shape (`{ work_item_ids: [...] }`) and remove-path shape
      (single `work_item_id` in the URL) both explicitly asserted in tests
- [x] `docs/plans/TRACK.md` updated: Phase 09 row `[~]` at start, `[x]` at
      completion

## Open questions

- None — endpoint shapes for this phase are fully specified in the spec
  report with no ambiguity.
