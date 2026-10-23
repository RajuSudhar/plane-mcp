import { describe, it, expect, mock } from 'bun:test';
import { PlaneApiError } from '../plane/errors';
import { toolHandler, WORK_ITEM_ID_TOOLS } from './register';
import { stubClient } from './client-stub';
import type { ToolResult, ServerConfig } from '@types';

describe('register', () => {
  describe('toolHandler', () => {
    const testConfig: ServerConfig = {
      defaults: { maxOutputTokens: 25000 },
      tools: {},
    };

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
          },
          testConfig
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
        },
        testConfig
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
        },
        testConfig
      );

      const res = await handler({ project_id: 'p1', work_item_id: 'w1', name: 'Updated' });

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.text).toContain('Internal server error');
      expect(content.text).not.toContain('retrieve_work_item_by_identifier');
    });

    it('result exceeding token limit is rejected with guidance', async () => {
      const client = stubClient({ get: async () => ({}) });

      const handler = toolHandler(
        'list_projects',
        client,
        async (_client, _args): Promise<ToolResult> => {
          // A large result that exceeds a low limit
          const largeData = Array.from({ length: 1000 }, (_, i) => ({
            id: `item-${i}`,
            name: `Item ${i}`,
            description: `This is a detailed description for item ${i}`,
          }));
          return {
            content: [{ type: 'text', text: JSON.stringify(largeData) }],
            structuredContent: { items: largeData },
          };
        },
        {
          defaults: { maxOutputTokens: 100 }, // Very low limit
          tools: {},
        }
      );

      const res = await handler({});

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.text).toContain('list_projects');
      expect(content.text).toContain('tokens');
      expect(content.text).toContain('100');
      expect(content.text).toContain('fields');
      expect(content.text).toContain('per_page');
      expect(content.text).toContain('retrieve_work_item_by_identifier');
      // list_projects has no cycle/module scoping — guidance must not invent it.
      expect(content.text).not.toContain('module_id');
      expect(content.text).not.toContain('cycle_id');
    });

    it('guidance names cycle/module scoping only for tools that accept it', async () => {
      const client = stubClient({ get: async () => ({}) });
      const big = Array.from({ length: 200 }, (_, i) => ({
        id: `w${i}`,
        name: `Work item ${i} with a reasonably long name to burn tokens`,
      }));

      const handler = toolHandler(
        'list_work_items',
        client,
        async (): Promise<ToolResult> => ({
          content: [{ type: 'text', text: JSON.stringify(big) }],
          structuredContent: { items: big },
        }),
        { defaults: { maxOutputTokens: 100 }, tools: {} }
      );

      const res = await handler({});
      const content = res.content[0] as { type: 'text'; text: string };

      expect(res.isError).toBe(true);
      expect(content.text).toContain('cycle_id');
      expect(content.text).toContain('module_id');
    });

    it('guidance omits fields/per_page for tools that accept neither', async () => {
      const client = stubClient({ get: async () => ({}) });
      const big = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, body: 'x'.repeat(40) }));

      const handler = toolHandler(
        'create_work_item',
        client,
        async (): Promise<ToolResult> => ({
          content: [{ type: 'text', text: JSON.stringify(big) }],
          structuredContent: { items: big },
        }),
        { defaults: { maxOutputTokens: 100 }, tools: {} }
      );

      const res = await handler({});
      const content = res.content[0] as { type: 'text'; text: string };

      expect(res.isError).toBe(true);
      expect(content.text).not.toContain('`fields`');
      expect(content.text).not.toContain('`per_page`');
      // Write tools get no max_output_tokens escape hatch either.
      expect(content.text).not.toContain('max_output_tokens:');
    });

    it('a request max_output_tokens above the ceiling is refused without calling the API', async () => {
      let called = false;
      const client = stubClient({ get: async () => ({}) });

      const handler = toolHandler(
        'list_cycles',
        client,
        async (): Promise<ToolResult> => {
          called = true;
          return { content: [{ type: 'text', text: '{}' }], structuredContent: {} };
        },
        { defaults: { maxOutputTokens: 25000, maxOutputTokensCeiling: 50000 }, tools: {} }
      );

      const res = await handler({ project_id: 'p1', max_output_tokens: 200000 });
      const content = res.content[0] as { type: 'text'; text: string };

      expect(res.isError).toBe(true);
      expect(called).toBe(false);
      expect(content.text).toContain('200000');
      expect(content.text).toContain('50000');
      expect(content.text).toContain('maxOutputTokensCeiling');
    });

    it('a request max_output_tokens under the ceiling raises the limit for that call', async () => {
      const client = stubClient({ get: async () => ({}) });
      const big = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, name: `Cycle ${i}` }));

      const handler = toolHandler(
        'list_cycles',
        client,
        async (): Promise<ToolResult> => ({
          content: [{ type: 'text', text: JSON.stringify(big) }],
          structuredContent: { cycles: big },
        }),
        { defaults: { maxOutputTokens: 100, maxOutputTokensCeiling: 100000 }, tools: {} }
      );

      // Without the override the same payload breaches the 100-token limit.
      expect((await handler({ project_id: 'p1' })).isError).toBe(true);

      const res = await handler({ project_id: 'p1', max_output_tokens: 90000 });
      expect(res.isError).toBeUndefined();
    });

    it('max_output_tokens is stripped before reaching the tool function', async () => {
      const client = stubClient({ get: async () => ({}) });
      let seen: Record<string, unknown> = {};

      const handler = toolHandler(
        'list_cycles',
        client,
        async (_client, args): Promise<ToolResult> => {
          seen = args;
          return { content: [{ type: 'text', text: '{}' }], structuredContent: {} };
        },
        { defaults: { maxOutputTokens: 25000 }, tools: {} }
      );

      await handler({ project_id: 'p1', max_output_tokens: 50000 });

      expect(seen).toEqual({ project_id: 'p1' });
      expect('max_output_tokens' in seen).toBe(false);
    });

    it('result under token limit passes through unmodified', async () => {
      const client = stubClient({ get: async () => ({}) });
      const testData = { id: 'p1', name: 'Test Project' };

      const handler = toolHandler(
        'retrieve_project',
        client,
        async (_client, _args): Promise<ToolResult> => {
          return {
            content: [{ type: 'text', text: JSON.stringify(testData) }],
            structuredContent: testData,
          };
        },
        {
          defaults: { maxOutputTokens: 25000 },
          tools: {},
        }
      );

      const res = await handler({ project_id: 'p1' });

      expect(res.isError).not.toBe(true);
      expect(res.content[0]?.type).toBe('text');
      expect(res.structuredContent).toEqual(testData);
    });

    it('error result with large payload is passed through unmodified', async () => {
      const client = stubClient({ get: async () => ({}) });

      const handler = toolHandler(
        'list_projects',
        client,
        async (_client, _args): Promise<ToolResult> => {
          return {
            content: [
              { type: 'text', text: 'A very large error message that is ' + 'x'.repeat(10000) },
            ],
            isError: true,
          };
        },
        {
          defaults: { maxOutputTokens: 100 }, // Low limit
          tools: {},
        }
      );

      const res = await handler({});

      expect(res.isError).toBe(true);
      // Should pass through unchanged, not re-wrapped
      expect(res.content[0]?.type).toBe('text');
      expect((res.content[0] as { type: 'text'; text: string }).text).toContain('very large error');
    });

    it('per-tool override is honored', async () => {
      const client = stubClient({ get: async () => ({}) });
      const largeData = Array.from({ length: 500 }, (_, i) => ({
        id: `item-${i}`,
        name: `Item ${i}`,
      }));

      const handler = toolHandler(
        'list_projects',
        client,
        async (_client, _args): Promise<ToolResult> => {
          return {
            content: [{ type: 'text', text: JSON.stringify(largeData) }],
            structuredContent: { items: largeData },
          };
        },
        {
          defaults: { maxOutputTokens: 25000 },
          tools: {
            list_projects: { maxOutputTokens: 100 }, // Override for this tool
          },
        }
      );

      const res = await handler({});

      expect(res.isError).toBe(true);
      const content = res.content[0] as { type: 'text'; text: string };
      expect(content.text).toContain('list_projects');
      expect(content.text).toContain('100'); // Should mention the overridden limit
    });
  });
});
