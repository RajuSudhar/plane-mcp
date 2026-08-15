import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import {
  listWorkItemRelations,
  createWorkItemRelation,
  removeWorkItemRelation,
  createWorkItemRelationSchema,
} from './relations';
import { toolHandler } from './register';
import { stubClient } from './client-stub';

describe('relations', () => {
  describe('list_work_item_relations', () => {
    it('success: lists relations and wraps array in structuredContent', async () => {
      const data = [{ id: 'r1', related_work_item_id: 'w2', relation_type: 'blocking' as const }];
      const getSpy = mock(async () => data);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_work_item_relations',
        client,
        listWorkItemRelations
      )({
        project_id: 'p1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));

      // Verify structuredContent wraps the array as { relations: [...] }
      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        relations?: unknown;
      };
      expect(structuredContent.relations).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('work-items/w1/relations/');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(404, 'not found');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_work_item_relations',
        client,
        listWorkItemRelations
      )({
        project_id: 'p1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('not found');
    });

    it('error path: generic Error → Unexpected error', async () => {
      const getSpy = mock(async () => {
        throw new Error('boom');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_work_item_relations',
        client,
        listWorkItemRelations
      )({
        project_id: 'p1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('create_work_item_relation', () => {
    it('success: creates relation with valid type', async () => {
      const relation = {
        id: 'r1',
        related_work_item_id: 'w2',
        relation_type: 'blocking' as const,
      };
      const postSpy = mock(async () => relation);
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_work_item_relation',
        client,
        createWorkItemRelation
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        related_work_item_id: 'w2',
        relation_type: 'blocking',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(relation));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(relation);

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('relations/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toMatchObject({
        relation_type: 'blocking',
        issues: ['w2'],
      });
    });

    it('error path: PlaneApiError', async () => {
      const postSpy = mock(async () => {
        throw new PlaneApiError(409, 'conflict');
      });
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_work_item_relation',
        client,
        createWorkItemRelation
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        related_work_item_id: 'w2',
        relation_type: 'blocking',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('conflict');
    });
  });

  describe('remove_work_item_relation', () => {
    it('success: removes relation', async () => {
      const deleteSpy = mock(async () => undefined);
      const client = stubClient({ delete: deleteSpy });

      const res = await toolHandler(
        'remove_work_item_relation',
        client,
        removeWorkItemRelation
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        relation_id: 'r1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Relation deleted');
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual({ deleted: true });

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      const callArgs = deleteSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('relations/r1/');
    });

    it('error path: PlaneApiError', async () => {
      const deleteSpy = mock(async () => {
        throw new PlaneApiError(404, 'no relation');
      });
      const client = stubClient({ delete: deleteSpy });

      const res = await toolHandler(
        'remove_work_item_relation',
        client,
        removeWorkItemRelation
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        relation_id: 'r1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('no relation');
    });
  });

  describe('relation_type validation', () => {
    it('invalid relation_type is rejected by schema', async () => {
      const parsed = createWorkItemRelationSchema.safeParse({
        project_id: 'p1',
        work_item_id: 'w1',
        related_work_item_id: 'w2',
        relation_type: 'bogus',
      });
      expect(parsed.success).toBe(false);
    });

    it('valid relation_type parses successfully', async () => {
      const parsed = createWorkItemRelationSchema.safeParse({
        project_id: 'p1',
        work_item_id: 'w1',
        related_work_item_id: 'w2',
        relation_type: 'blocking',
      });
      expect(parsed.success).toBe(true);
    });

    it('all valid relation types parse successfully', async () => {
      const validTypes = [
        'blocking',
        'blocked_by',
        'duplicate_of',
        'duplicate',
        'relates_to',
      ] as const;

      for (const relationType of validTypes) {
        const parsed = createWorkItemRelationSchema.safeParse({
          project_id: 'p1',
          work_item_id: 'w1',
          related_work_item_id: 'w2',
          relation_type: relationType,
        });
        expect(parsed.success).toBe(true);
      }
    });
  });
});
