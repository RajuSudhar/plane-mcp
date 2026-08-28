#!/usr/bin/env bun
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { serverConfigSchema } from '../src/config';

const jsonSchema = z.toJSONSchema(serverConfigSchema, { target: 'draft-7' });

const output = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'plane-mcp server config',
  description:
    'Validated behavior config for plane-mcp: per-tool output-token limits. See https://github.com/RajuSudhar/plane-mcp for discovery order and defaults.',
  ...jsonSchema,
};

const target = new URL('../plane-mcp.config.schema.json', import.meta.url);
await writeFile(target, JSON.stringify(output, null, 2) + '\n');
