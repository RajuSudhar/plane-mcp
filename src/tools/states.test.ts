import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import { listStates, createState, createStateSchema } from './states';
import { toolHandler } from './register';
import { stubClient } from './client-stub';
import { testConfig } from './test-config';

describe('states', () => {
  describe('list_states', () => {
    it('success: lists states and wraps array in structuredContent', async () => {
      const data = [{ id: 's1', name: 'Todo', group: 'unstarted' }];
      const getSpy = mock(async () => data);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_states',
        client,
        listStates,
        testConfig
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));

      // Verify structuredContent wraps the array as { states: [...] }
      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        states?: unknown;
      };
      expect(structuredContent.states).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/states/');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(500, 'boom');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_states',
        client,
        listStates,
        testConfig
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('boom');
    });

    it('error path: generic Error → Unexpected error', async () => {
      const getSpy = mock(async () => {
        throw new Error('boom');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_states',
        client,
        listStates,
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

  describe('create_state', () => {
    it('success: creates state with valid group', async () => {
      const state = { id: 's1', name: 'Todo', color: '#F59E0B', group: 'started' };
      const postSpy = mock(async () => state);
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_state',
        client,
        createState,
        testConfig
      )({
        project_id: 'p1',
        name: 'Todo',
        color: '#F59E0B',
        group: 'started',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(state));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(state);

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('states/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toMatchObject({
        name: 'Todo',
        color: '#F59E0B',
        group: 'started',
      });
      expect(bodyArg.project_id).toBeUndefined();
    });

    it('error path: PlaneApiError', async () => {
      const postSpy = mock(async () => {
        throw new PlaneApiError(409, 'conflict');
      });
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_state',
        client,
        createState,
        testConfig
      )({
        project_id: 'p1',
        name: 'Todo',
        color: '#F59E0B',
        group: 'started',
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
        'create_state',
        client,
        createState,
        testConfig
      )({
        project_id: 'p1',
        name: 'Todo',
        color: '#F59E0B',
        group: 'started',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('createStateSchema validation', () => {
    it('invalid group is rejected by schema', async () => {
      const parsed = createStateSchema.safeParse({
        project_id: 'p1',
        name: 'X',
        color: '#FFFFFF',
        group: 'done',
      });
      expect(parsed.success).toBe(false);
    });

    it('valid group parses successfully', async () => {
      const parsed = createStateSchema.safeParse({
        project_id: 'p1',
        name: 'X',
        color: '#FFFFFF',
        group: 'started',
      });
      expect(parsed.success).toBe(true);
    });

    it('invalid color (not hex) is rejected by schema', async () => {
      const parsed = createStateSchema.safeParse({
        project_id: 'p1',
        name: 'X',
        color: 'red',
        group: 'started',
      });
      expect(parsed.success).toBe(false);
    });

    it('valid color (hex format) parses successfully', async () => {
      const parsed = createStateSchema.safeParse({
        project_id: 'p1',
        name: 'X',
        color: '#FFFFFF',
        group: 'started',
      });
      expect(parsed.success).toBe(true);
    });

    it('all valid groups parse successfully', async () => {
      const validGroups = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const;

      for (const group of validGroups) {
        const parsed = createStateSchema.safeParse({
          project_id: 'p1',
          name: 'X',
          color: '#FFFFFF',
          group,
        });
        expect(parsed.success).toBe(true);
      }
    });
  });
});
