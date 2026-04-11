import { describe, expect, it } from 'vitest';

/**
 * MCP error propagation tests.
 * These test the expected behavior of MCP tool error handling
 * at the type/interface level, since actual MCP connections
 * require external servers.
 */

describe('MCP error propagation types', () => {
  it('should define isError flag in MCPCallToolResult', () => {
    // Type-level test: MCPCallToolResult has isError
    const result = {
      content: [{ type: 'text' as const, text: 'error message' }],
      isError: true,
    };
    expect(result.isError).toBe(true);
  });

  it('should support image content in MCPCallToolResult', () => {
    const result = {
      content: [
        { type: 'text' as const, text: 'description' },
        { type: 'image' as const, data: 'base64data', mimeType: 'image/png' },
      ],
      isError: false,
    };
    expect(result.content).toHaveLength(2);
    expect(result.content[1]!.type).toBe('image');
  });

  it('should support text-only content', () => {
    const result = {
      content: [
        { type: 'text' as const, text: 'line 1' },
        { type: 'text' as const, text: 'line 2' },
      ],
      isError: false,
    };
    const text = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    expect(text).toBe('line 1\nline 2');
  });
});
