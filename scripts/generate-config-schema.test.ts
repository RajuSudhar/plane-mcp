import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { serverConfigSchema } from '../src/config';

describe('generate-config-schema', () => {
  it('committed schema matches freshly generated schema', async () => {
    // Generate schema in-memory
    const freshJsonSchema = z.toJSONSchema(serverConfigSchema, { target: 'draft-7' });
    const freshOutput = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'plane-mcp server config',
      description:
        'Validated behavior config for plane-mcp: per-tool output-token limits. See https://github.com/RajuSudhar/plane-mcp for discovery order and defaults.',
      ...freshJsonSchema,
    };

    // Read committed schema
    const schemaPath = new URL('../plane-mcp.config.schema.json', import.meta.url);
    const committedContent = await readFile(schemaPath, 'utf-8');
    const committed = JSON.parse(committedContent);

    // Deep equality check
    expect(committed).toEqual(freshOutput);
  });
});
