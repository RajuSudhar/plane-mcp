import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import {
  listWorkItems,
  retrieveWorkItem,
  retrieveWorkItemByIdentifier,
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  searchWorkItems,
} from './work-items';
import { toolHandler } from './register';
import { stubClient } from './client-stub';
import { testConfig } from './test-config';

describe('work-items', () => {
  describe('list_work_items', () => {
    it('success: filters are comma-joined in query', async () => {
      const envelope = { results: [{ id: 'w1' }], count: 1 };
      const getSpy = mock(async () => envelope);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_work_items',
        client,
        listWorkItems,
        testConfig
      )({
        project_id: 'p1',
        state_ids: ['s1', 's2'],
        priorities: ['high'],
        per_page: 20,
        cursor: 'c1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(envelope));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(envelope);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/work-items/');
      const queryArg = callArgs[1] as Record<string, unknown>;
      expect(queryArg).toMatchObject({
        state_ids: 's1,s2',
        priorities: 'high',
        per_page: 20,
        cursor: 'c1',
      });
    });

    it('success: passthrough all filter params', async () => {
      const envelope = { results: [{ id: 'w1' }], count: 1 };
      const getSpy = mock(async () => envelope);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_work_items',
        client,
        listWorkItems,
        testConfig
      )({
        project_id: 'p1',
        assignee_ids: ['a1', 'a2'],
        label_ids: ['l1'],
        cycle_ids: ['cy1'],
        module_ids: ['m1'],
        query: 'foo',
        fields: 'id,name',
        expand: 'state',
        state_ids: ['s1'],
        priorities: ['high'],
        per_page: 10,
        cursor: 'c1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(envelope));

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const queryArg = callArgs[1] as Record<string, unknown>;
      expect(queryArg.assignee_ids).toBe('a1,a2');
      expect(queryArg.label_ids).toBe('l1');
      expect(queryArg.cycle_ids).toBe('cy1');
      expect(queryArg.module_ids).toBe('m1');
      expect(queryArg.query).toBe('foo');
      expect(queryArg.fields).toBe('id,name');
      expect(queryArg.expand).toBe('state');
      expect(queryArg.state_ids).toBe('s1');
      expect(queryArg.priorities).toBe('high');
      expect(queryArg.per_page).toBe(10);
      expect(queryArg.cursor).toBe('c1');
    });

    it('error path: PlaneApiError', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(500, 'boom');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'list_work_items',
        client,
        listWorkItems,
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
        'list_work_items',
        client,
        listWorkItems,
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

  describe('retrieve_work_item', () => {
    it('success: calls get with correct path', async () => {
      const data = { id: 'w1', name: 'Bug' };
      const getSpy = mock(async () => data);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'retrieve_work_item',
        client,
        retrieveWorkItem,
        testConfig
      )({
        project_id: 'p1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/work-items/w1/');
    });

    it('error path: PlaneApiError 404', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(404, 'not found');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'retrieve_work_item',
        client,
        retrieveWorkItem,
        testConfig
      )({
        project_id: 'p1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('not found');
    });
  });

  describe('retrieve_work_item_by_identifier', () => {
    it('success: calls get with issues identifier path', async () => {
      const data = { id: 'w1', name: 'Task' };
      const getSpy = mock(async () => data);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'retrieve_work_item_by_identifier',
        client,
        retrieveWorkItemByIdentifier,
        testConfig
      )({
        identifier: 'BZ-5777',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(data);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('issues/BZ-5777/');
    });

    it('success: trims padded identifier and uses trimmed version in path', async () => {
      const data = { id: 'w1', name: 'Task' };
      const getSpy = mock(async () => data);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'retrieve_work_item_by_identifier',
        client,
        retrieveWorkItemByIdentifier,
        testConfig
      )({
        identifier: '  BZ-5777  ',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(data));

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toEndWith('issues/BZ-5777/');
    });

    it('error path: PlaneApiError 404 does not append UUID hint (not in WORK_ITEM_ID_TOOLS)', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(404, 'Issue not found');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'retrieve_work_item_by_identifier',
        client,
        retrieveWorkItemByIdentifier,
        testConfig
      )({
        identifier: 'BZ-5777',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('Issue not found');
      expect(content.text).not.toContain('retrieve_work_item_by_identifier');
    });
  });

  describe('create_work_item', () => {
    it('success: normalization (state_id→state, assignee_ids→assignees, due_date→target_date)', async () => {
      const createdItem = { id: 'w1', name: 'Bug' };
      const postSpy = mock(async () => createdItem);
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_work_item',
        client,
        createWorkItem,
        testConfig
      )({
        project_id: 'p1',
        name: 'Bug',
        state_id: 'st1',
        assignee_ids: ['a1'],
        due_date: '2026-01-01',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(createdItem));

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('projects/p1/work-items/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg.state).toBe('st1');
      expect(bodyArg.assignees).toEqual(['a1']);
      expect(bodyArg.target_date).toBe('2026-01-01');
      expect(bodyArg.name).toBe('Bug');

      expect(bodyArg.state_id).toBeUndefined();
      expect(bodyArg.assignee_ids).toBeUndefined();
      expect(bodyArg.due_date).toBeUndefined();
    });

    it('success: create with full fields', async () => {
      const createdItem = { id: 'w2', name: 'Feature' };
      const postSpy = mock(async () => createdItem);
      const client = stubClient({ post: postSpy });

      const res = await toolHandler(
        'create_work_item',
        client,
        createWorkItem,
        testConfig
      )({
        project_id: 'p1',
        name: 'Feature',
        description_html: '<p>Details</p>',
        priority: 'high',
        state_id: 'st2',
        assignee_ids: ['a1', 'a2'],
        label_ids: ['l1'],
        type_id: 't1',
        parent_id: 'p-id',
        start_date: '2026-01-01',
        due_date: '2026-02-01',
        estimate_point: '5',
        external_id: 'ext1',
        external_source: 'src1',
      });

      expect(res.isError).toBeFalsy();

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs = postSpy.mock.calls[0] as unknown[];
      const bodyArg = callArgs[1] as Record<string, unknown>;

      expect(bodyArg.name).toBe('Feature');
      expect(bodyArg.description_html).toBe('<p>Details</p>');
      expect(bodyArg.priority).toBe('high');
      expect(bodyArg.state).toBe('st2');
      expect(bodyArg.assignees).toEqual(['a1', 'a2']);
      expect(bodyArg.labels).toEqual(['l1']);
      expect(bodyArg.type_id).toBe('t1');
      expect(bodyArg.parent).toBe('p-id');
      expect(bodyArg.start_date).toBe('2026-01-01');
      expect(bodyArg.target_date).toBe('2026-02-01');
      expect(bodyArg.estimate_point).toBe('5');
      expect(bodyArg.external_id).toBe('ext1');
      expect(bodyArg.external_source).toBe('src1');
    });
  });

  describe('update_work_item', () => {
    it('success: normalization (state_id→state)', async () => {
      const updatedItem = { id: 'w1', name: 'Updated' };
      const patchSpy = mock(async () => updatedItem);
      const client = stubClient({ patch: patchSpy });

      const res = await toolHandler(
        'update_work_item',
        client,
        updateWorkItem,
        testConfig
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        priority: 'urgent',
        state_id: 'st2',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(updatedItem));

      expect(patchSpy).toHaveBeenCalledTimes(1);
      const callArgs = patchSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('work-items/w1/');

      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg.state).toBe('st2');
      expect(bodyArg.priority).toBe('urgent');
      expect(bodyArg.state_id).toBeUndefined();
    });

    it('success: partial update with labels', async () => {
      const updatedItem = { id: 'w1' };
      const patchSpy = mock(async () => updatedItem);
      const client = stubClient({ patch: patchSpy });

      const res = await toolHandler(
        'update_work_item',
        client,
        updateWorkItem,
        testConfig
      )({
        project_id: 'p1',
        work_item_id: 'w1',
        label_ids: ['l1', 'l2'],
      });

      expect(res.isError).toBeFalsy();

      const callArgs = patchSpy.mock.calls[0] as unknown[];
      const bodyArg = callArgs[1] as Record<string, unknown>;
      expect(bodyArg.labels).toEqual(['l1', 'l2']);
    });
  });

  describe('delete_work_item', () => {
    it('success: returns deleted: true', async () => {
      const deleteSpy = mock(async () => undefined);
      const client = stubClient({ delete: deleteSpy });

      const res = await toolHandler(
        'delete_work_item',
        client,
        deleteWorkItem,
        testConfig
      )({
        project_id: 'p1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Work item deleted');
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual({ deleted: true });

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      const callArgs = deleteSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('work-items/w1/');
    });

    it('error path: delete throws PlaneApiError', async () => {
      const deleteSpy = mock(async () => {
        throw new PlaneApiError(404, 'work item not found');
      });
      const client = stubClient({ delete: deleteSpy });

      const res = await toolHandler(
        'delete_work_item',
        client,
        deleteWorkItem,
        testConfig
      )({
        project_id: 'p1',
        work_item_id: 'w1',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('work item not found');
    });
  });

  describe('search_work_items', () => {
    it('success: query mapped to q parameter', async () => {
      const results = { results: [{ id: 'w1' }], count: 1 };
      const getSpy = mock(async () => results);
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'search_work_items',
        client,
        searchWorkItems,
        testConfig
      )({
        project_id: 'p1',
        query: 'login bug',
      });

      expect(res.isError).toBeFalsy();
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe(JSON.stringify(results));
      expect((res as { structuredContent?: unknown }).structuredContent).toEqual(results);

      expect(getSpy).toHaveBeenCalledTimes(1);
      const callArgs = getSpy.mock.calls[0] as unknown[];
      const pathArg = callArgs[0] as string;
      expect(pathArg).toContain('work-items/search/');

      const queryArg = callArgs[1] as Record<string, unknown>;
      expect(queryArg.q).toBe('login bug');
    });

    it('error path: search throws generic Error', async () => {
      const getSpy = mock(async () => {
        throw new Error('timeout');
      });
      const client = stubClient({ get: getSpy });

      const res = await toolHandler(
        'search_work_items',
        client,
        searchWorkItems,
        testConfig
      )({
        project_id: 'p1',
        query: 'test',
      });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toBe('Unexpected error');
    });
  });
});
