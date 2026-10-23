import { describe, it, expect } from 'bun:test';
import { Glob } from 'bun';
import { FIELDS_TOOLS, PER_PAGE_TOOLS, OVERRIDE_TOOLS } from './register';

/**
 * The guidance strings in register.ts are driven by capability sets. If a set
 * claims a parameter the tool's Zod schema does not declare, the server tells
 * callers to retry with an argument that fails validation — the exact defect
 * Phase 26 exists to fix. These tests read the registered schemas straight from
 * source and assert the sets match in BOTH directions.
 */

const SKIP = new Set(['register.ts', 'token-count.ts', 'client-stub.ts', 'test-config.ts']);

type Registered = { toolName: string; schemaBody: string; file: string };

async function readRegisteredTools(): Promise<Registered[]> {
  const dir = import.meta.dir;
  const found: Registered[] = [];

  for await (const rel of new Glob('*.ts').scan({ cwd: dir })) {
    if (rel.endsWith('.test.ts') || SKIP.has(rel)) continue;
    const source = await Bun.file(`${dir}/${rel}`).text();

    // server.registerTool('name', { ... inputSchema: someSchema ... }, handler)
    const calls = source.matchAll(
      /registerTool\(\s*'([a-z_]+)'\s*,\s*\{[\s\S]*?inputSchema:\s*(\w+)/g
    );

    for (const call of calls) {
      const toolName = call[1];
      const schemaVar = call[2];
      if (!toolName || !schemaVar) continue;

      const declaration = new RegExp(`const ${schemaVar} = z\\.object\\(\\{`).exec(source);
      if (!declaration) throw new Error(`${rel}: could not find schema '${schemaVar}'`);

      // Walk to the brace that closes z.object({ — handles both the one-line
      // empty case (`z.object({})`) and multi-line bodies.
      const start = declaration.index + declaration[0].length;
      let depth = 1;
      let end = -1;
      for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) throw new Error(`${rel}: unterminated schema '${schemaVar}'`);

      found.push({ toolName, schemaBody: source.slice(start, end), file: rel });
    }
  }

  return found;
}

const declares = (body: string, param: string): boolean =>
  new RegExp(`^\\s*${param}:`, 'm').test(body);

describe('guidance capability sets match the registered schemas', () => {
  it('finds every registered tool', async () => {
    const tools = await readRegisteredTools();
    expect(tools.length).toBe(31);
  });

  const cases: Array<{ set: Set<string>; param: string; label: string }> = [
    { set: FIELDS_TOOLS, param: 'fields', label: 'FIELDS_TOOLS' },
    { set: PER_PAGE_TOOLS, param: 'per_page', label: 'PER_PAGE_TOOLS' },
    { set: OVERRIDE_TOOLS, param: 'max_output_tokens', label: 'OVERRIDE_TOOLS' },
  ];

  for (const { set, param, label } of cases) {
    it(`${label}: every listed tool actually declares \`${param}\``, async () => {
      const tools = await readRegisteredTools();
      const missing = [...set].filter((name) => {
        const tool = tools.find((t) => t.toolName === name);
        return !tool || !declares(tool.schemaBody, param);
      });

      expect(missing).toEqual([]);
    });

    it(`${label}: every tool declaring \`${param}\` is listed`, async () => {
      const tools = await readRegisteredTools();
      const unlisted = tools
        .filter((t) => declares(t.schemaBody, param) && !set.has(t.toolName))
        .map((t) => t.toolName);

      expect(unlisted).toEqual([]);
    });
  }
});
