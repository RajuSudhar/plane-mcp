import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import type { PlaneClient } from '../plane/client';
import { getMe } from './users';
import { toolHandler } from './register';

const makeClient = (getImpl: (...a: unknown[]) => Promise<unknown>) =>
  ({
    get: getImpl,
    post: async () => undefined,
    patch: async () => undefined,
    delete: async () => undefined,
    apiPath: (s: string) => '/api/v1/' + s.replace(/^\//, ''),
    workspacePath: (s: string) => '/api/v1/workspaces/ws/' + s.replace(/^\//, ''),
  }) as unknown as PlaneClient;

describe('get_me', () => {
  it('success: resolves user data', async () => {
    const data = { id: 'u1', email: 'a@b.c' };
    const getSpy = mock(async () => data);
    const client = makeClient(getSpy);

    const res = await toolHandler('get_me', client, getMe)({});

    expect(res.isError).toBeFalsy();
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toBe(JSON.stringify(data));
    }
    expect((res as { structuredContent?: unknown }).structuredContent).toEqual(data);
    expect(getSpy.mock.calls.length).toBe(1);
    const firstCallArg = getSpy.mock.calls[0] as unknown[];
    expect(firstCallArg[0] as string).toContain('users/me/');
  });

  it('PlaneApiError path: returns error message', async () => {
    const getSpy = mock(async () => {
      throw new PlaneApiError(404, 'Not found');
    });
    const client = makeClient(getSpy);

    const res = await toolHandler('get_me', client, getMe)({});

    expect(res.isError).toBe(true);
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toContain('Not found');
    }
  });

  it('generic error path: returns "Unexpected error"', async () => {
    const getSpy = mock(async () => {
      throw new Error('boom');
    });
    const client = makeClient(getSpy);

    const res = await toolHandler('get_me', client, getMe)({});

    expect(res.isError).toBe(true);
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toBe('Unexpected error');
    }
  });
});
