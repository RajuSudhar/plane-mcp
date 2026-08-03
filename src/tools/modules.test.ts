import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import type { PlaneClient } from '../plane/client';
import {
  listModules,
  createModule,
  addWorkItemsToModule,
  addWorkItemsToModuleSchema,
  removeWorkItemFromModule,
} from './modules';
import { toolHandler } from './register';

type Spies = {
  get?: (...a: unknown[]) => Promise<unknown>;
  post?: (...a: unknown[]) => Promise<unknown>;
  patch?: (...a: unknown[]) => Promise<unknown>;
  delete?: (...a: unknown[]) => Promise<unknown>;
};

const makeClient = (spies: Spies) =>
  ({
    get: spies.get ?? mock(async () => ({})),
    post: spies.post ?? mock(async () => ({})),
    patch: spies.patch ?? mock(async () => ({})),
    delete: spies.delete ?? mock(async () => undefined),
    apiPath: (s: string) => '/api/v1/' + s.replace(/^\//, ''),
    workspacePath: (s: string) => '/api/v1/workspaces/ws/' + s.replace(/^\//, ''),
  }) as unknown as PlaneClient;

describe('modules', () => {
  describe('list_modules', () => {
    it('success: lists modules and wraps array in structuredContent', async () => {
      const data = [
        {
          id: 'm1',
          name: 'Auth',
          description: '',
          start_date: null,
          target_date: null,
          project_id: 'p1',
          workspace_id: 'ws',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];
      const getSpy = mock(async () => data);
      const client = makeClient({ get: getSpy });

      const res = await toolHandler(
        'list_modules',
        client,
        listModules
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));

      // Verify structuredContent wraps the array as { modules: [...] }
      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        modules?: unknown;
      };
      expect(structuredContent.modules).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/modules/');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(404, 'nope');
      });
      const client = makeClient({ get: getSpy });

      const res = await toolHandler(
        'list_modules',
        client,
        listModules
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
      const client = makeClient({ get: getSpy });

      const res = await toolHandler(
        'list_modules',
        client,
        listModules
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('create_module', () => {
    it('success: creates module with target_date and members', async () => {
      const module = {
        id: 'm1',
        name: 'Auth',
        description: '',
        start_date: null,
        target_date: '2026-02-01',
        project_id: 'p1',
        workspace_id: 'ws',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const postSpy = mock(async () => module);
      const client = makeClient({ post: postSpy });

      const res = await toolHandler(
        'create_module',
        client,
        createModule
      )({
        project_id: 'p1',
        name: 'Auth',
        target_date: '2026-02-01',
        members: ['u1'],
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(module));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(module);

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('modules/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toMatchObject({
        name: 'Auth',
        target_date: '2026-02-01',
        members: ['u1'],
      });
      expect((bodyArg as Record<string, unknown>).project_id).toBeUndefined();
    });

    it('error path: PlaneApiError', async () => {
      const postSpy = mock(async () => {
        throw new PlaneApiError(409, 'conflict');
      });
      const client = makeClient({ post: postSpy });

      const res = await toolHandler(
        'create_module',
        client,
        createModule
      )({
        project_id: 'p1',
        name: 'Auth',
        target_date: '2026-02-01',
        members: ['u1'],
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
      const client = makeClient({ post: postSpy });

      const res = await toolHandler(
        'create_module',
        client,
        createModule
      )({
        project_id: 'p1',
        name: 'Auth',
        target_date: '2026-02-01',
        members: ['u1'],
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('add_work_items_to_module', () => {
    it('success: adds work items to module', async () => {
      const postSpy = mock(async () => ({}));
      const client = makeClient({ post: postSpy });

      const res = await toolHandler(
        'add_work_items_to_module',
        client,
        addWorkItemsToModule
      )({
        project_id: 'p1',
        module_id: 'm1',
        work_item_ids: ['w1'],
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify({}));

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('modules/m1/work-items/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toEqual({ work_item_ids: ['w1'] });
    });

    it('error path: PlaneApiError', async () => {
      const postSpy = mock(async () => {
        throw new PlaneApiError(404, 'not found');
      });
      const client = makeClient({ post: postSpy });

      const res = await toolHandler(
        'add_work_items_to_module',
        client,
        addWorkItemsToModule
      )({
        project_id: 'p1',
        module_id: 'm1',
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
      const client = makeClient({ post: postSpy });

      const res = await toolHandler(
        'add_work_items_to_module',
        client,
        addWorkItemsToModule
      )({
        project_id: 'p1',
        module_id: 'm1',
        work_item_ids: ['w1'],
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('remove_work_item_from_module', () => {
    it('success: removes work item from module', async () => {
      const deleteSpy = mock(async () => undefined);
      const client = makeClient({ delete: deleteSpy });

      const res = await toolHandler(
        'remove_work_item_from_module',
        client,
        removeWorkItemFromModule
      )({
        project_id: 'p1',
        module_id: 'm1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Work item removed from module');

      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        removed?: boolean;
      };
      expect(structuredContent.removed).toBe(true);

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      const callArgs = deleteSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('modules/m1/work-items/w1/');
    });

    it('error path: PlaneApiError', async () => {
      const deleteSpy = mock(async () => {
        throw new PlaneApiError(404, 'work item not found');
      });
      const client = makeClient({ delete: deleteSpy });

      const res = await toolHandler(
        'remove_work_item_from_module',
        client,
        removeWorkItemFromModule
      )({
        project_id: 'p1',
        module_id: 'm1',
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
      const client = makeClient({ delete: deleteSpy });

      const res = await toolHandler(
        'remove_work_item_from_module',
        client,
        removeWorkItemFromModule
      )({
        project_id: 'p1',
        module_id: 'm1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('addWorkItemsToModuleSchema validation', () => {
    it('empty work_item_ids is rejected by schema', async () => {
      const parsed = addWorkItemsToModuleSchema.safeParse({
        project_id: 'p1',
        module_id: 'm1',
        work_item_ids: [],
      });
      expect(parsed.success).toBe(false);
    });

    it('valid work_item_ids parses successfully', async () => {
      const parsed = addWorkItemsToModuleSchema.safeParse({
        project_id: 'p1',
        module_id: 'm1',
        work_item_ids: ['w1'],
      });
      expect(parsed.success).toBe(true);
    });
  });
});
