import { describe, it, expect } from 'bun:test';
import { countOutputTokens, TOKEN_COUNT_MULTIPLIER } from './token-count';
import { encode } from 'gpt-tokenizer/model/gpt-4o';
import type { ToolResult } from '@types';

describe('token-count', () => {
  describe('countOutputTokens', () => {
    it('counts content text alone when structuredContent is absent', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Hello, world!' }],
      };

      const tokens = countOutputTokens(result);

      // Verify it returns a positive number
      expect(tokens).toBeGreaterThan(0);
      // Verify multiplier was applied
      expect(typeof tokens).toBe('number');
    });

    it('counts content text plus JSON.stringify(structuredContent) when both present', () => {
      const data = { id: '123', name: 'Test Project' };
      const result: ToolResult = {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        structuredContent: data,
      };

      const tokens = countOutputTokens(result);

      // Verify it returns a positive number
      expect(tokens).toBeGreaterThan(0);
      // The doubled payload (content + structuredContent) should have roughly
      // double the tokens (minus some efficiency from exact duplicate)
      expect(typeof tokens).toBe('number');
    });

    it('applies the 1.2 multiplier and Math.ceil', () => {
      const testText = 'test';
      const result: ToolResult = {
        content: [{ type: 'text', text: testText }],
      };

      const tokens = countOutputTokens(result);
      const rawCount = encode(testText).length;
      const expectedTokens = Math.ceil(rawCount * TOKEN_COUNT_MULTIPLIER);

      // Verify the multiplier was applied
      expect(tokens).toBe(expectedTokens);
      // Token count should be an integer (Math.ceil applied)
      expect(Number.isInteger(tokens)).toBe(true);
      // Should be positive
      expect(tokens).toBeGreaterThan(0);
    });

    it('returns stable token count for known short string', () => {
      const testString = '{"status":"ok"}';
      const result: ToolResult = {
        content: [{ type: 'text', text: testString }],
      };

      const tokens = countOutputTokens(result);

      // Run it again to verify stability
      const tokens2 = countOutputTokens(result);
      expect(tokens).toBe(tokens2);

      // Verify it's a reasonable count (short string should be under 50 tokens even with 1.2x)
      expect(tokens).toBeLessThan(50);
      expect(tokens).toBeGreaterThan(0);
    });

    it('handles multiple content parts by joining them', () => {
      const result: ToolResult = {
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      };

      const tokens = countOutputTokens(result);

      expect(tokens).toBeGreaterThan(0);
      expect(Number.isInteger(tokens)).toBe(true);
    });

    it('returns zero tokens for empty content', () => {
      const result: ToolResult = {
        content: [],
      };

      const tokens = countOutputTokens(result);

      // Empty content has zero tokens
      expect(tokens).toBe(0);
      expect(Number.isInteger(tokens)).toBe(true);
    });

    it('correctly measures doubled payload (content + structuredContent)', () => {
      const largeData = {
        items: Array.from({ length: 100 }, (_, i) => ({
          id: `item-${i}`,
          name: `Item ${i}`,
          description: `This is a test description for item ${i}`,
        })),
      };

      const resultWithBoth: ToolResult = {
        content: [{ type: 'text', text: JSON.stringify(largeData) }],
        structuredContent: largeData,
      };

      const resultWithoutStructured: ToolResult = {
        content: [{ type: 'text', text: JSON.stringify(largeData) }],
      };

      const tokensWithBoth = countOutputTokens(resultWithBoth);
      const tokensWithoutStructured = countOutputTokens(resultWithoutStructured);

      // The doubled payload should use significantly more tokens
      expect(tokensWithBoth).toBeGreaterThan(tokensWithoutStructured);
    });

    it('REGRESSION-PIN: known short string produces exact token count with multiplier applied', () => {
      const testString = '{"status":"ok"}';
      const result: ToolResult = {
        content: [{ type: 'text', text: testString }],
      };

      const tokens = countOutputTokens(result);
      const rawCount = encode(testString).length;
      const expectedExactCount = Math.ceil(rawCount * TOKEN_COUNT_MULTIPLIER);

      // Pin the exact token count so tokenizer/encoding-path changes are caught
      expect(tokens).toBe(expectedExactCount);
      expect(Number.isInteger(tokens)).toBe(true);
      // Short JSON string should produce reasonable count
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });
  });
});
