import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import type { PlaneClient } from '../plane/client';
import { getProjectMembers, getWorkspaceMembers } from './members';
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

describe('members', () => {
  describe('get_project_members', () => {
    it('success: lists project members and wraps array in structuredContent', async () => {
      const data = [{ id: 'm1', member_id: 'u1', role: 20 }];
      const getSpy = mock(async () => data);
      const client = makeClient({ get: getSpy });

      const res = await toolHandler(
        'get_project_members',
        client,
        getProjectMembers
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));

      // Verify structuredContent wraps the array as { members: [...] }
      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        members?: unknown;
      };
      expect(structuredContent.members).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/members/');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(404, 'not found');
      });
      const client = makeClient({ get: getSpy });

      const res = await toolHandler(
        'get_project_members',
        client,
        getProjectMembers
      )({
        project_id: 'p1',
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
      const client = makeClient({ get: getSpy });

      const res = await toolHandler(
        'get_project_members',
        client,
        getProjectMembers
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('get_workspace_members', () => {
    it('success: lists workspace members and wraps array in structuredContent', async () => {
      const data = [{ id: 'm1', member_id: 'u1', role: 20 }];
      const getSpy = mock(async () => data);
      const client = makeClient({ get: getSpy });

      const res = await toolHandler('get_workspace_members', client, getWorkspaceMembers)({});

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));

      // Verify structuredContent wraps the array as { members: [...] }
      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        members?: unknown;
      };
      expect(structuredContent.members).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      // Workspace members path should contain 'members/' and NOT contain 'projects/'
      expect(pathArg).toContain('members/');
      expect(pathArg).not.toContain('projects/');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(403, 'forbidden');
      });
      const client = makeClient({ get: getSpy });

      const res = await toolHandler('get_workspace_members', client, getWorkspaceMembers)({});

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('forbidden');
    });

    it('error path: generic Error → Unexpected error', async () => {
      const getSpy = mock(async () => {
        throw new Error('boom');
      });
      const client = makeClient({ get: getSpy });

      const res = await toolHandler('get_workspace_members', client, getWorkspaceMembers)({});

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });
});
