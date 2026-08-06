import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import { listProjects, retrieveProject } from './projects';
import { toolHandler } from './register';
import { stubClient } from './client-stub';

describe('list_projects', () => {
  it('success with pagination passthrough', async () => {
    const envelope = { results: [{ id: 'p1' }], count: 1 };
    const getSpy = mock(async () => envelope);
    const client = stubClient({ get: getSpy });

    const res = await toolHandler(
      'list_projects',
      client,
      listProjects
    )({
      cursor: 'c1',
      per_page: 10,
    });

    expect(res.isError).toBeFalsy();
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toBe(JSON.stringify(envelope));
    }
    expect((res as { structuredContent?: unknown }).structuredContent).toEqual(envelope);

    // Verify cursor and per_page pass through untouched - unconditional assertion
    expect(getSpy).toHaveBeenCalledTimes(1);
    const callArgs = getSpy.mock.calls[0] as unknown[];
    expect(callArgs[1]).toMatchObject({ cursor: 'c1', per_page: 10 });
  });

  it('error path: PlaneApiError', async () => {
    const getSpy = mock(async () => {
      throw new PlaneApiError(500, 'boom');
    });
    const client = stubClient({ get: getSpy });

    const res = await toolHandler('list_projects', client, listProjects)({});

    expect(res.isError).toBe(true);
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toContain('boom');
    }
  });

  it('error path: generic Error → Unexpected error', async () => {
    const getSpy = mock(async () => {
      throw new Error('boom');
    });
    const client = stubClient({ get: getSpy });

    const res = await toolHandler('list_projects', client, listProjects)({});

    expect(res.isError).toBe(true);
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toBe('Unexpected error');
    }
  });
});

describe('retrieve_project', () => {
  it('success: resolves project data', async () => {
    const data = { id: 'p1', name: 'Eng' };
    const getSpy = mock(async () => data);
    const client = stubClient({ get: getSpy });

    const res = await toolHandler(
      'retrieve_project',
      client,
      retrieveProject
    )({
      project_id: 'p1',
    });

    expect(res.isError).toBeFalsy();
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toBe(JSON.stringify(data));
    }
    expect((res as { structuredContent?: unknown }).structuredContent).toEqual(data);

    const callArgs = getSpy.mock.calls[0] as unknown[] | undefined;
    if (callArgs && callArgs.length > 0) {
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/');
    }
  });

  it('error path: PlaneApiError 404', async () => {
    const getSpy = mock(async () => {
      throw new PlaneApiError(404, 'nope');
    });
    const client = stubClient({ get: getSpy });

    const res = await toolHandler(
      'retrieve_project',
      client,
      retrieveProject
    )({
      project_id: 'p1',
    });

    expect(res.isError).toBe(true);
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toContain('nope');
    }
  });

  it('error path: generic Error → Unexpected error', async () => {
    const getSpy = mock(async () => {
      throw new Error('kaboom');
    });
    const client = stubClient({ get: getSpy });

    const res = await toolHandler(
      'retrieve_project',
      client,
      retrieveProject
    )({
      project_id: 'p1',
    });

    expect(res.isError).toBe(true);
    const content = res.content[0];
    if (content.type === 'text') {
      expect(content.text).toBe('Unexpected error');
    }
  });
});
