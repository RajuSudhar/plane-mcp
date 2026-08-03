import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import type { PlaneClient } from '../plane/client';
import {
  listWorkItemComments,
  createWorkItemComment,
  updateWorkItemComment,
  deleteWorkItemComment,
} from './comments';
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

describe('comments', () => {
  describe('list_work_item_comments', () => {
    it('success: lists comments with pagination envelope', async () => {
      const envelope = { results: [{ id: 'c1' }], count: 1 };
      const getSpy = mock(async () => envelope);
      const client = makeClient({ get: getSpy });

      const res = await toolHandler(
        'list_work_item_comments',
        client,
        listWorkItemComments
      )({
        project_id: 'p1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(envelope));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(envelope);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('work-items/w1/comments/');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(404, 'nope');
      });
      const client = makeClient({ get: getSpy });

      const res = await toolHandler(
        'list_work_item_comments',
        client,
        listWorkItemComments
      )({
        project_id: 'p1',
        work_item_id: 'w1',
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
        'list_work_item_comments',
        client,
        listWorkItemComments
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

  describe('create_work_item_comment', () => {
    it('success: creates comment and returns it', async () => {
      const comment = { id: 'c1', comment_html: '<p>hi</p>' };
      const postSpy = mock(async () => comment);
      const client = makeClient({ post: postSpy });

      const res = await toolHandler(
        'create_work_item_comment',
        client,
        createWorkItemComment
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        comment_html: '<p>hi</p>',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(comment));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(comment);

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('comments/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toMatchObject({ comment_html: '<p>hi</p>' });
    });

    it('error path: PlaneApiError', async () => {
      const postSpy = mock(async () => {
        throw new PlaneApiError(400, 'bad comment');
      });
      const client = makeClient({ post: postSpy });

      const res = await toolHandler(
        'create_work_item_comment',
        client,
        createWorkItemComment
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        comment_html: '<p>hi</p>',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('bad comment');
    });
  });

  describe('update_work_item_comment', () => {
    it('success: updates comment', async () => {
      const comment = { id: 'c1', comment_html: '<p>edit</p>' };
      const patchSpy = mock(async () => comment);
      const client = makeClient({ patch: patchSpy });

      const res = await toolHandler(
        'update_work_item_comment',
        client,
        updateWorkItemComment
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        comment_id: 'c1',
        comment_html: '<p>edit</p>',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(comment));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(comment);

      expect(patchSpy).toHaveBeenCalledTimes(1);
      const callArgs = patchSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('comments/c1/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toMatchObject({ comment_html: '<p>edit</p>' });
    });

    it('error path: PlaneApiError', async () => {
      const patchSpy = mock(async () => {
        throw new PlaneApiError(404, 'no comment');
      });
      const client = makeClient({ patch: patchSpy });

      const res = await toolHandler(
        'update_work_item_comment',
        client,
        updateWorkItemComment
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        comment_id: 'c1',
        comment_html: '<p>edit</p>',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('no comment');
    });
  });

  describe('delete_work_item_comment', () => {
    it('success: deletes comment', async () => {
      const deleteSpy = mock(async () => undefined);
      const client = makeClient({ delete: deleteSpy });

      const res = await toolHandler(
        'delete_work_item_comment',
        client,
        deleteWorkItemComment
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        comment_id: 'c1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Comment deleted');
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual({ deleted: true });

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      const callArgs = deleteSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('comments/c1/');
    });

    it('error path: PlaneApiError', async () => {
      const deleteSpy = mock(async () => {
        throw new PlaneApiError(403, 'forbidden');
      });
      const client = makeClient({ delete: deleteSpy });

      const res = await toolHandler(
        'delete_work_item_comment',
        client,
        deleteWorkItemComment
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        comment_id: 'c1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('forbidden');
    });
  });
});
