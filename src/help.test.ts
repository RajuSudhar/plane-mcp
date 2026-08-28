import { describe, it, expect } from 'bun:test';
import { buildHelpText, printHelp } from './help';

describe('help', () => {
  describe('buildHelpText', () => {
    it('contains init command and options', () => {
      const text = buildHelpText();
      expect(text).toContain('plane-mcp init');
      expect(text).toContain('--workspace');
      expect(text).toContain('--base-url');
      expect(text).toContain('--port');
      expect(text).toContain('--key');
      expect(text).toContain('--register');
    });

    it('contains -y flag', () => {
      const text = buildHelpText();
      expect(text).toContain('-y');
      expect(text).toContain('Skip config-scaffold prompts');
    });

    it('contains --config-path flag', () => {
      const text = buildHelpText();
      expect(text).toContain('--config-path');
      expect(text).toContain('Config file location');
    });

    it('contains --max-output-tokens flag', () => {
      const text = buildHelpText();
      expect(text).toContain('--max-output-tokens');
      expect(text).toContain('output-token limit');
    });

    it('contains behavior config information', () => {
      const text = buildHelpText();
      expect(text).toContain('Behavior config');
      expect(text).toContain('plane-mcp.config.json');
      expect(text).toContain('Discovery order');
      expect(text).toContain('PLANE_MCP_CONFIG');
    });

    it('contains PLANE_MCP_MAX_OUTPUT_TOKENS', () => {
      const text = buildHelpText();
      expect(text).toContain('PLANE_MCP_MAX_OUTPUT_TOKENS');
    });

    it('contains auth env vars', () => {
      const text = buildHelpText();
      expect(text).toContain('PLANE_API_KEY');
      expect(text).toContain('PLANE_MCP_INSTANCE');
      expect(text).toContain('PLANE_WORKSPACE_SLUG');
      expect(text).toContain('PLANE_BASE_URL');
      expect(text).toContain('PORT');
    });

    it('contains help command', () => {
      const text = buildHelpText();
      expect(text).toContain('plane-mcp help');
    });
  });

  describe('printHelp', () => {
    it('writes help text to the provided write function', () => {
      const output: string[] = [];
      const mockWrite = (s: string) => {
        output.push(s);
      };

      printHelp(mockWrite);

      const fullOutput = output.join('');
      expect(fullOutput).toContain('plane-mcp');
      expect(fullOutput).toContain('init');
      expect(fullOutput).toContain('help');
    });

    it('defaults to process.stdout.write when no write function provided', () => {
      // This test just verifies the function runs without error with the default
      let writeWasCalled = false;
      const originalWrite = process.stdout.write.bind(process.stdout);

      const mockWrite = (_s: string): boolean => {
        writeWasCalled = true;
        return true;
      };

      process.stdout.write = mockWrite;

      try {
        printHelp();
        expect(writeWasCalled).toBe(true);
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });
});
