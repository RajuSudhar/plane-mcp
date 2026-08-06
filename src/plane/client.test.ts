import { describe, expect, it, mock } from 'bun:test';
import { PlaneClient } from './client';
import { PlaneApiError, PlaneRateLimitError } from './errors';
import { toWorkItemWriteBody } from './normalize';
import type { FetchLike, Priority } from '@types';

const AUTH = { apiKey: 'test-key', workspaceSlug: 'acme', baseUrl: 'https://api.plane.so' };

describe('PlaneClient', () => {
  it('should build the correct URL and inject X-API-Key header', async () => {
    const mockFetch = mock<FetchLike>(
      async (input: URL | string, init?: RequestInit): Promise<Response> => {
        expect(input).toBe('https://api.plane.so/api/v1/workspaces/acme/projects/');
        const apiKey = new Headers(init?.headers).get('X-API-Key');
        expect(apiKey).toBe('test-key');
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
    );

    const client = new PlaneClient(AUTH, mockFetch);
    await client.get(client.workspacePath('projects/'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should pass the pagination envelope through untouched', async () => {
    const envelope = { next_cursor: '20:1:0', results: [{ id: '1' }] };
    const mockFetch = mock<FetchLike>(
      async (): Promise<Response> => new Response(JSON.stringify(envelope), { status: 200 })
    );

    const client = new PlaneClient(AUTH, mockFetch);
    const result = await client.get('/api/v1/workspaces/acme/projects/');
    expect(result).toEqual(envelope);
  });

  it('should retry on 429 and eventually throw PlaneRateLimitError after MAX_RETRIES', async () => {
    const mockFetch = mock<FetchLike>(
      async (): Promise<Response> =>
        new Response('rate limited', {
          status: 429,
          headers: { 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000)) },
        })
    );

    const client = new PlaneClient(AUTH, mockFetch);
    // oxlint-disable-next-line typescript/await-thenable - expect().rejects returns a Promise; Bun test types not recognized
    await expect(client.get('/api/v1/workspaces/acme/projects/')).rejects.toBeInstanceOf(
      PlaneRateLimitError
    );
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('should throw PlaneApiError for 4xx/5xx responses', async () => {
    const mockFetch = mock<FetchLike>(
      async (): Promise<Response> => new Response('not found', { status: 404 })
    );

    const client = new PlaneClient(AUTH, mockFetch);
    // oxlint-disable-next-line typescript/await-thenable - expect().rejects returns a Promise; Bun test types not recognized
    await expect(client.get('/api/v1/workspaces/acme/projects/missing/')).rejects.toBeInstanceOf(
      PlaneApiError
    );
  });

  it('should handle POST requests with body', async () => {
    const requestBody = { name: 'test' };
    const mockFetch = mock<FetchLike>(
      async (_input: URL | string, _init?: RequestInit): Promise<Response> => {
        expect(_init?.method).toBe('POST');
        expect(_init?.body).toBe(JSON.stringify(requestBody));
        return new Response(JSON.stringify({ id: '1' }), { status: 201 });
      }
    );

    const client = new PlaneClient(AUTH, mockFetch);
    const result = await client.post('/api/v1/workspaces/acme/projects/', requestBody);
    expect(result).toEqual({ id: '1' });
  });

  it('should handle 204 No Content responses', async () => {
    const mockFetch = mock<FetchLike>(
      async (): Promise<Response> => new Response('', { status: 204 })
    );

    const client = new PlaneClient(AUTH, mockFetch);
    const result = await client.delete('/api/v1/workspaces/acme/projects/1');
    expect(result).toBeUndefined();
  });

  it('should pass query parameters through URL search params', async () => {
    const mockFetch = mock<FetchLike>(async (input: URL | string): Promise<Response> => {
      const urlStr = input instanceof URL ? input.href : input;
      expect(urlStr).toContain('cursor=20%3A1%3A0');
      expect(urlStr).toContain('per_page=10');
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });

    const client = new PlaneClient(AUTH, mockFetch);
    await client.get('/api/v1/workspaces/acme/projects/', {
      cursor: '20:1:0',
      per_page: 10,
    });
  });

  it('should skip undefined query parameters', async () => {
    const mockFetch = mock<FetchLike>(async (input: URL | string): Promise<Response> => {
      const urlStr = input instanceof URL ? input.href : input;
      expect(urlStr).not.toContain('undefined');
      expect(urlStr).toContain('per_page=10');
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });

    const client = new PlaneClient(AUTH, mockFetch);
    await client.get('/api/v1/workspaces/acme/projects/', {
      cursor: undefined,
      per_page: 10,
    });
  });

  it('should return undefined for empty response body with 200 status', async () => {
    const mockFetch = mock<FetchLike>(
      async (): Promise<Response> => new Response('', { status: 200 })
    );

    const client = new PlaneClient(AUTH, mockFetch);
    const result = await client.get('/api/v1/workspaces/acme/projects/');
    expect(result).toBeUndefined();
  });
});

describe('toWorkItemWriteBody', () => {
  it('should map renamed fields (dueDate -> target_date)', () => {
    const input = { dueDate: '2024-12-31' };
    const result = toWorkItemWriteBody(input);
    expect(result.target_date).toBe('2024-12-31');
  });

  it('should map renamed fields (stateId -> state)', () => {
    const input = { stateId: 'state-123' };
    const result = toWorkItemWriteBody(input);
    expect(result.state).toBe('state-123');
  });

  it('should map renamed fields (assigneeIds -> assignees)', () => {
    const input = { assigneeIds: ['user-1', 'user-2'] };
    const result = toWorkItemWriteBody(input);
    expect(result.assignees).toEqual(['user-1', 'user-2']);
  });

  it('should pass through name field unchanged', () => {
    const input = { name: 'Test Issue' };
    const result = toWorkItemWriteBody(input);
    expect(result.name).toBe('Test Issue');
  });

  it('should omit undefined fields', () => {
    const input = { name: 'Test' };
    const result = toWorkItemWriteBody(input);
    expect(result.name).toBe('Test');
    expect(Object.keys(result).length).toBe(1);
  });

  it('should handle mixed renamed and passthrough fields', () => {
    const input = {
      name: 'Test Issue',
      descriptionHtml: '<p>Test</p>',
      stateId: 'state-123',
      dueDate: '2024-12-31',
    };
    const result = toWorkItemWriteBody(input);
    expect(result.name).toBe('Test Issue');
    expect(result.description_html).toBe('<p>Test</p>');
    expect(result.state).toBe('state-123');
    expect(result.target_date).toBe('2024-12-31');
  });

  it('should handle null parent field', () => {
    const input = { parentId: null };
    const result = toWorkItemWriteBody(input);
    expect(result.parent).toBeNull();
  });

  it('should handle all fields together', () => {
    const priority: Priority = 'high';
    const input = {
      name: 'Issue',
      descriptionHtml: '<p>Desc</p>',
      priority,
      stateId: 'state-1',
      assigneeIds: ['user-1'],
      labelIds: ['label-1'],
      typeId: 'type-1',
      parentId: 'parent-1',
      startDate: '2024-01-01',
      dueDate: '2024-12-31',
      estimatePoint: '5',
      externalId: 'ext-1',
      externalSource: 'jira',
    };
    const result = toWorkItemWriteBody(input);
    expect(result).toEqual({
      name: 'Issue',
      description_html: '<p>Desc</p>',
      priority: 'high',
      state: 'state-1',
      assignees: ['user-1'],
      labels: ['label-1'],
      type_id: 'type-1',
      parent: 'parent-1',
      start_date: '2024-01-01',
      target_date: '2024-12-31',
      estimate_point: '5',
      external_id: 'ext-1',
      external_source: 'jira',
    });
  });
});
