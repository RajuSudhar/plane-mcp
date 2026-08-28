import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import {
  listCycles,
  createCycle,
  addWorkItemsToCycle,
  addWorkItemsToCycleSchema,
  removeWorkItemFromCycle,
} from './cycles';
import { toolHandler } from './register';
import { stubClient } from './client-stub';
import { testConfig } from './test-config';

describe('cycles', () => {
  describe('list_cycles', () => {
    it('success: lists cycles and wraps array in structuredContent', async () => {
      const data = [
        {
          id: 'cy1',
          name: 'Sprint 1',
          description: '',
          start_date: null,
          end_date: null,
          project_id: 'p1',
          workspace_id: 'ws',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];
      const getSpy = mock(async () => data);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_cycles',
        client,
        listCycles,
        testConfig
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));

      // Verify structuredContent wraps the array as { cycles: [...] }
      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        cycles?: unknown;
      };
      expect(structuredContent.cycles).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/cycles/');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(404, 'nope');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_cycles',
        client,
        listCycles,
        testConfig
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('nope');
    });

    it('error path: generic Error → Unexpected error', async () => {
      const getSpy = mock(async () => {
        throw new Error('boom');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_cycles',
        client,
        listCycles,
        testConfig
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('create_cycle', () => {
    it('success: creates cycle with dates', async () => {
      const cycle = {
        id: 'cy1',
        name: 'Sprint 1',
        description: '',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
        project_id: 'p1',
        workspace_id: 'ws',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const postSpy = mock(async () => cycle);
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_cycle',
        client,
        createCycle,
        testConfig
      )({
        project_id: 'p1',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(cycle));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(cycle);

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('cycles/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toMatchObject({
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      });
      expect(bodyArg.project_id).toBeUndefined();
    });

    it('error path: PlaneApiError', async () => {
      const postSpy = mock(async () => {
        throw new PlaneApiError(409, 'conflict');
      });
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_cycle',
        client,
        createCycle,
        testConfig
      )({
        project_id: 'p1',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('conflict');
    });

    it('error path: generic Error → Unexpected error', async () => {
      const postSpy = mock(async () => {
        throw new Error('boom');
      });
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_cycle',
        client,
        createCycle,
        testConfig
      )({
        project_id: 'p1',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('add_work_items_to_cycle', () => {
    it('success: adds work items to cycle', async () => {
      const postSpy = mock(async () => ({}));
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'add_work_items_to_cycle',
        client,
        addWorkItemsToCycle,
        testConfig
      )({
        project_id: 'p1',
        cycle_id: 'cy1',
        work_item_ids: ['w1', 'w2'],
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify({}));

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('cycles/cy1/cycle-issues/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toEqual({ issues: ['w1', 'w2'] });
    });

    it('error path: PlaneApiError', async () => {
      const postSpy = mock(async () => {
        throw new PlaneApiError(404, 'not found');
      });
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'add_work_items_to_cycle',
        client,
        addWorkItemsToCycle,
        testConfig
      )({
        project_id: 'p1',
        cycle_id: 'cy1',
        work_item_ids: ['w1'],
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('not found');
    });

    it('error path: generic Error → Unexpected error', async () => {
      const postSpy = mock(async () => {
        throw new Error('boom');
      });
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'add_work_items_to_cycle',
        client,
        addWorkItemsToCycle,
        testConfig
      )({
        project_id: 'p1',
        cycle_id: 'cy1',
        work_item_ids: ['w1'],
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('remove_work_item_from_cycle', () => {
    it('success: removes work item from cycle', async () => {
      const deleteSpy = mock(async () => undefined);
      const client = stubClient({ delete: deleteSpy });

      const res = await toolHandler(
        'remove_work_item_from_cycle',
        client,
        removeWorkItemFromCycle,
        testConfig
      )({
        project_id: 'p1',
        cycle_id: 'cy1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Work item removed from cycle');

      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        removed?: boolean;
      };
      expect(structuredContent.removed).toBe(true);

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      const callArgs = deleteSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('cycles/cy1/cycle-issues/w1/');
    });

    it('error path: PlaneApiError', async () => {
      const deleteSpy = mock(async () => {
        throw new PlaneApiError(404, 'work item not found');
      });
      const client = stubClient({ delete: deleteSpy });

      const res = await toolHandler(
        'remove_work_item_from_cycle',
        client,
        removeWorkItemFromCycle,
        testConfig
      )({
        project_id: 'p1',
        cycle_id: 'cy1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('work item not found');
    });

    it('error path: generic Error → Unexpected error', async () => {
      const deleteSpy = mock(async () => {
        throw new Error('boom');
      });
      const client = stubClient({ delete: deleteSpy });

      const res = await toolHandler(
        'remove_work_item_from_cycle',
        client,
        removeWorkItemFromCycle,
        testConfig
      )({
        project_id: 'p1',
        cycle_id: 'cy1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('addWorkItemsToCycleSchema validation', () => {
    it('empty work_item_ids is rejected by schema', async () => {
      const parsed = addWorkItemsToCycleSchema.safeParse({
        project_id: 'p1',
        cycle_id: 'cy1',
        work_item_ids: [],
      });
      expect(parsed.success).toBe(false);
    });

    it('valid work_item_ids parses successfully', async () => {
      const parsed = addWorkItemsToCycleSchema.safeParse({
        project_id: 'p1',
        cycle_id: 'cy1',
        work_item_ids: ['w1'],
      });
      expect(parsed.success).toBe(true);
    });
  });
});
