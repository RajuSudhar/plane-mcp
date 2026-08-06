import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import { listLabels, createLabel, createLabelSchema } from './labels';
import { toolHandler } from './register';
import { stubClient } from './client-stub';

describe('labels', () => {
  describe('list_labels', () => {
    it('success: lists labels and wraps array in structuredContent', async () => {
      const data = [{ id: 'l1', name: 'bug', color: '#FF0000' }];
      const getSpy = mock(async () => data);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_labels',
        client,
        listLabels
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));

      // Verify structuredContent wraps the array as { labels: [...] }
      const structuredContent = (res as { structuredContent?: unknown }).structuredContent as {
        labels?: unknown;
      };
      expect(structuredContent.labels).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/labels/');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(500, 'boom');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_labels',
        client,
        listLabels
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
        'list_labels',
        client,
        listLabels
      )({
        project_id: 'p1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('create_label', () => {
    it('success: creates label with valid color', async () => {
      const label = { id: 'l1', name: 'bug', color: '#FF0000' };
      const postSpy = mock(async () => label);
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_label',
        client,
        createLabel
      )({
        project_id: 'p1',
        name: 'bug',
        color: '#FF0000',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(label));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(label);

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('labels/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg).toMatchObject({
        name: 'bug',
        color: '#FF0000',
      });
      expect(bodyArg.project_id).toBeUndefined();
    });

    it('error path: PlaneApiError', async () => {
      const postSpy = mock(async () => {
        throw new PlaneApiError(409, 'conflict');
      });
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_label',
        client,
        createLabel
      )({
        project_id: 'p1',
        name: 'bug',
        color: '#FF0000',
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
        'create_label',
        client,
        createLabel
      )({
        project_id: 'p1',
        name: 'bug',
        color: '#FF0000',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });

  describe('createLabelSchema validation', () => {
    it('invalid color (not hex) is rejected by schema', async () => {
      const parsed = createLabelSchema.safeParse({
        project_id: 'p1',
        name: 'bug',
        color: 'notahex',
      });
      expect(parsed.success).toBe(false);
    });

    it('valid color (hex format) parses successfully', async () => {
      const parsed = createLabelSchema.safeParse({
        project_id: 'p1',
        name: 'bug',
        color: '#00FF00',
      });
      expect(parsed.success).toBe(true);
    });

    it('optional parent field parses with null', async () => {
      const parsed = createLabelSchema.safeParse({
        project_id: 'p1',
        name: 'bug',
        color: '#FF0000',
        parent: null,
      });
      expect(parsed.success).toBe(true);
    });

    it('optional parent field parses with string value', async () => {
      const parsed = createLabelSchema.safeParse({
        project_id: 'p1',
        name: 'bug',
        color: '#FF0000',
        parent: 'parent-id',
      });
      expect(parsed.success).toBe(true);
    });
  });
});
