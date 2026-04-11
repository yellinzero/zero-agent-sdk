import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSDKTool, findToolByName, toolMatchesName } from '../tools/types.js';

describe('buildSDKTool', () => {
  it('should create a tool with defaults', () => {
    const tool = buildSDKTool({
      name: 'test',
      inputSchema: z.object({ x: z.string() }),
      maxResultSizeChars: 1000,
      async call(args) {
        return { data: args.x };
      },
      async description() {
        return 'A test tool';
      },
      async prompt() {
        return 'Use this tool for testing';
      },
    });

    expect(tool.name).toBe('test');
    expect(tool.isEnabled()).toBe(true);
    expect(tool.isConcurrencySafe({ x: '' })).toBe(false);
    expect(tool.isReadOnly({ x: '' })).toBe(false);
    expect(tool.isDestructive?.({ x: '' })).toBe(false);
  });

  it('should allow overriding defaults', () => {
    const tool = buildSDKTool({
      name: 'reader',
      inputSchema: z.object({}),
      maxResultSizeChars: 1000,
      async call() {
        return { data: 'ok' };
      },
      async description() {
        return 'reader';
      },
      async prompt() {
        return 'reader';
      },
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
    });

    expect(tool.isConcurrencySafe({})).toBe(true);
    expect(tool.isReadOnly({})).toBe(true);
  });

  it('should have a working mapToolResult default', () => {
    const tool = buildSDKTool({
      name: 'test',
      inputSchema: z.object({}),
      maxResultSizeChars: 1000,
      async call() {
        return { data: 'hello' };
      },
      async description() {
        return '';
      },
      async prompt() {
        return '';
      },
    });

    const result = tool.mapToolResult('hello', 'id-1');
    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('id-1');
    expect(result.content).toBe('hello');
  });

  it('should JSON-stringify non-string results', () => {
    const tool = buildSDKTool({
      name: 'test',
      inputSchema: z.object({}),
      maxResultSizeChars: 1000,
      async call() {
        return { data: { foo: 'bar' } };
      },
      async description() {
        return '';
      },
      async prompt() {
        return '';
      },
    });

    const result = tool.mapToolResult({ foo: 'bar' } as any, 'id-1');
    expect(result.content).toBe('{"foo":"bar"}');
  });
});

describe('toolMatchesName', () => {
  it('should match primary name', () => {
    expect(toolMatchesName({ name: 'Bash', aliases: ['BashTool'] }, 'Bash')).toBe(true);
  });

  it('should match alias', () => {
    expect(toolMatchesName({ name: 'Bash', aliases: ['BashTool'] }, 'BashTool')).toBe(true);
  });

  it('should not match unrelated name', () => {
    expect(toolMatchesName({ name: 'Bash', aliases: ['BashTool'] }, 'Read')).toBe(false);
  });
});

describe('findToolByName', () => {
  const tools = [
    buildSDKTool({
      name: 'Read',
      aliases: ['FileReadTool'],
      inputSchema: z.object({}),
      maxResultSizeChars: 1000,
      async call() {
        return { data: '' };
      },
      async description() {
        return '';
      },
      async prompt() {
        return '';
      },
    }),
    buildSDKTool({
      name: 'Write',
      inputSchema: z.object({}),
      maxResultSizeChars: 1000,
      async call() {
        return { data: '' };
      },
      async description() {
        return '';
      },
      async prompt() {
        return '';
      },
    }),
  ];

  it('should find by name', () => {
    expect(findToolByName(tools, 'Read')?.name).toBe('Read');
    expect(findToolByName(tools, 'Write')?.name).toBe('Write');
  });

  it('should find by alias', () => {
    expect(findToolByName(tools, 'FileReadTool')?.name).toBe('Read');
  });

  it('should return undefined for unknown', () => {
    expect(findToolByName(tools, 'Unknown')).toBeUndefined();
  });
});
