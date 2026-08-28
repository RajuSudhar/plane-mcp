import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import { toolHandler, WORK_ITEM_ID_TOOLS } from './register';
import { stubClient } from './client-stub';
import type { ToolResult } from '@types';

describe('register', () => {
  describe('toolHandler', () => {
    it('404 error for all WORK_ITEM_ID_TOOLS appends UUID hint', async () => {
      const toolNames = Array.from(WORK_ITEM_ID_TOOLS);
      for (const toolName of toolNames) {
        const getSpy = mock(async () => {
          throw new PlaneApiError(404, 'Work item not found');
        });
        const client = stubClient({ get: getSpy });

        const handler = toolHandler(
          toolName,
          client,
          async (_client, _args): Promise<ToolResult> => {
            throw new PlaneApiError(404, 'Work item not found');
          }
        );

        const res = await handler({ project_id: 'p1', work_item_id: 'w1' });

        expect(res.isError).toBe(true);
        const content = res.content[0] as { type: 'text'; text: string };
        expect(content.text).toContain('Work item not found');
        expect(content.text).toContain('retrieve_work_item_by_identifier');
      }
    });

    it('404 error for non-work-item-id tool does not append UUID hint', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(404, 'Project not found');
      });
      const client = stubClient({ get: getSpy });

      const handler = toolHandler(
        'list_work_items',
        client,
        async (_client, _args): Promise<ToolResult> => {
          throw new PlaneApiError(404, 'Project not found');
        }
      );

      const res = await handler({ project_id: 'p1' });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.text).toBe('Plane API error 404: Project not found');
      expect(content.text).not.toContain('retrieve_work_item_by_identifier');
    });

    it('non-404 error for work-item-id tool does not append UUID hint', async () => {
      const getSpy = mock(async () => {
        throw new PlaneApiError(500, 'Internal server error');
      });
      const client = stubClient({ get: getSpy });

      const handler = toolHandler(
        'update_work_item',
        client,
        async (_client, _args): Promise<ToolResult> => {
          throw new PlaneApiError(500, 'Internal server error');
        }
      );

      const res = await handler({ project_id: 'p1', work_item_id: 'w1', name: 'Updated' });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.text).toContain('Internal server error');
      expect(content.text).not.toContain('retrieve_work_item_by_identifier');
    });
  });
});
