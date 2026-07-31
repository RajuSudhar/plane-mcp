# feat-collaboration

Phase: 07  |  Status: [ ] planned
Depends on: 06-work-items
Ref: `plans/plane-mcp/00-rfc.md`, `../../../docs/plane-api-reference.md` §3.10, §6.6, §6.8

## Goal

Implement work item comments (list/create/update/delete) and relations
(list/create/remove).

## In scope

- `src/tools/comments.ts` — `list_work_item_comments`,
  `create_work_item_comment`, `update_work_item_comment`,
  `delete_work_item_comment`.
- `src/tools/relations.ts` — `list_work_item_relations`,
  `create_work_item_relation`, `remove_work_item_relation`.
- Zod schemas incl. `relation_type` enum validation.
- Unit tests for all 7 tools against a mocked `PlaneClient`.
- Update `src/server.ts` to register both new modules.

## Out of scope

- Work item links, activities, worklogs, attachments (all out of RFC scope).
- Comment `access` (INTERNAL/EXTERNAL) toggling — not in the locked tool
  list; `create_work_item_comment` accepts only `comment_html`, matching
  spec report §6.6's required-args table (no `access` param listed there).

## Design

### Endpoint map

| Tool | Method | Path |
| --- | --- | --- |
| `list_work_item_comments` | GET | `projects/{project_id}/work-items/{work_item_id}/comments/` |
| `create_work_item_comment` | POST | `projects/{project_id}/work-items/{work_item_id}/comments/` |
| `update_work_item_comment` | PATCH | `projects/{project_id}/work-items/{work_item_id}/comments/{comment_id}/` |
| `delete_work_item_comment` | DELETE | `projects/{project_id}/work-items/{work_item_id}/comments/{comment_id}/` |
| `list_work_item_relations` | GET | `projects/{project_id}/work-items/{work_item_id}/relations/` |
| `create_work_item_relation` | POST | `projects/{project_id}/work-items/{work_item_id}/relations/` |
| `remove_work_item_relation` | DELETE | `projects/{project_id}/work-items/{work_item_id}/relations/{relation_id}/` |

### Zod schemas

```typescript
import { z } from 'zod';

const listCommentsSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
});

const createCommentSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  comment_html: z.string(),
});

const updateCommentSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  comment_id: z.string(),
  comment_html: z.string(),
});

const deleteCommentSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  comment_id: z.string(),
});

const relationType = z.enum(['blocking', 'blocked_by', 'duplicate_of', 'duplicate', 'relates_to']);

const listRelationsSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
});

const createRelationSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  related_work_item_id: z.string(),
  relation_type: relationType,
});

const removeRelationSchema = z.object({
  project_id: z.string(),
  work_item_id: z.string(),
  relation_id: z.string(),
});
```

**CRITICAL**: `relation_type` is a closed `z.enum` — Plane's API vocabulary
per spec report §6.8 is exactly `blocking | blocked_by | duplicate_of |
duplicate | relates_to`. Reject anything else at the zod layer before it
reaches `PlaneClient`, so an invalid value is a clear validation error, not
an opaque 400 from Plane.

### `src/tools/comments.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { Comment } from '@types/plane';
import { toolHandler } from './register';

// ... schemas from Design section ...

export function registerCommentTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_work_item_comments',
    { description: 'List comments on a work item.', inputSchema: listCommentsSchema },
    toolHandler('list_work_item_comments', client, async (c, args) => {
      const comments = await c.get<Comment[]>(
        c.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/comments/`),
      );
      return { content: [{ type: 'text', text: JSON.stringify(comments) }], structuredContent: { comments } };
    }),
  );

  server.registerTool(
    'create_work_item_comment',
    { description: 'Add a comment to a work item.', inputSchema: createCommentSchema },
    toolHandler('create_work_item_comment', client, async (c, args) => {
      const comment = await c.post<Comment>(
        c.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/comments/`),
        { comment_html: args.comment_html },
      );
      return { content: [{ type: 'text', text: JSON.stringify(comment) }], structuredContent: comment };
    }),
  );

  server.registerTool(
    'update_work_item_comment',
    { description: 'Edit an existing comment.', inputSchema: updateCommentSchema },
    toolHandler('update_work_item_comment', client, async (c, args) => {
      const comment = await c.patch<Comment>(
        c.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/comments/${args.comment_id}/`),
        { comment_html: args.comment_html },
      );
      return { content: [{ type: 'text', text: JSON.stringify(comment) }], structuredContent: comment };
    }),
  );

  server.registerTool(
    'delete_work_item_comment',
    { description: 'Delete a comment.', inputSchema: deleteCommentSchema },
    toolHandler('delete_work_item_comment', client, async (c, args) => {
      await c.delete(
        c.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/comments/${args.comment_id}/`),
      );
      return { content: [{ type: 'text', text: 'deleted' }] };
    }),
  );
}
```

### `src/tools/relations.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PlaneClient } from '../plane/client';
import type { Relation } from '@types/plane';
import { toolHandler } from './register';

// ... schemas from Design section ...

export function registerRelationTools(server: McpServer, client: PlaneClient): void {
  server.registerTool(
    'list_work_item_relations',
    { description: 'List relations (blocks, duplicates, etc.) for a work item.', inputSchema: listRelationsSchema },
    toolHandler('list_work_item_relations', client, async (c, args) => {
      const relations = await c.get<Relation[]>(
        c.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/relations/`),
      );
      return { content: [{ type: 'text', text: JSON.stringify(relations) }], structuredContent: { relations } };
    }),
  );

  server.registerTool(
    'create_work_item_relation',
    {
      description: 'Create a relation between two work items (blocking, blocked_by, duplicate_of, duplicate, relates_to).',
      inputSchema: createRelationSchema,
    },
    toolHandler('create_work_item_relation', client, async (c, args) => {
      const relation = await c.post<Relation>(
        c.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/relations/`),
        { related_work_item_id: args.related_work_item_id, relation_type: args.relation_type },
      );
      return { content: [{ type: 'text', text: JSON.stringify(relation) }], structuredContent: relation };
    }),
  );

  server.registerTool(
    'remove_work_item_relation',
    { description: 'Remove a relation from a work item.', inputSchema: removeRelationSchema },
    toolHandler('remove_work_item_relation', client, async (c, args) => {
      await c.delete(
        c.workspacePath(`projects/${args.project_id}/work-items/${args.work_item_id}/relations/${args.relation_id}/`),
      );
      return { content: [{ type: 'text', text: 'removed' }] };
    }),
  );
}
```

## Tasks

- [ ] Write zod schemas for both modules per Design
- [ ] Implement `registerCommentTools` (4 tools)
- [ ] Implement `registerRelationTools` (3 tools)
- [ ] Wire both into `src/server.ts`
- [ ] Write `src/tools/comments.test.ts` — success + error path per tool
- [ ] Write `src/tools/relations.test.ts` — success + error path per tool,
      plus an explicit test asserting an invalid `relation_type` (e.g.
      `"invalid_type"`) is rejected by zod before any client call is made
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes

## Definition of done

- [ ] All 7 tools (4 comment + 3 relation) registered and callable
- [ ] `relation_type` enum validated — invalid value never reaches
      `PlaneClient`
- [ ] `docs/plans/TRACK.md` updated: Phase 07 row `[~]` at start, `[x]` at
      completion

## Open questions

- None — this phase's endpoint shapes and vocabularies are fully specified
  in `../../../docs/plane-api-reference.md` §3.10/§6.6/§6.8 with no ambiguity requiring
  a design call.
