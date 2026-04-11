import { describe, expect, it } from 'vitest';
import {
  microCompact,
  postCompactCleanup,
  shouldCompact,
  truncateHeadForPTLRetry,
} from '../context/compact.js';
import type { ProviderMessage } from '../providers/types.js';

function makeTextMessage(role: 'user' | 'assistant', text: string): ProviderMessage {
  return { role, content: [{ type: 'text', text }] };
}

function makeToolUseMessage(id: string, name: string): ProviderMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input: {} }],
  };
}

function makeToolResultMessage(toolUseId: string, result: string): ProviderMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content: result }],
  };
}

describe('shouldCompact', () => {
  it('should return false when under threshold', () => {
    const messages = [makeTextMessage('user', 'hi')];
    expect(shouldCompact(messages, 100_000, 0.8)).toBe(false);
  });

  it('should return true when over threshold', () => {
    // Create a message that's very large
    const bigText = 'x'.repeat(400_000); // ~100K tokens
    const messages = [makeTextMessage('user', bigText)];
    expect(shouldCompact(messages, 50_000, 0.8)).toBe(true);
  });
});

describe('microCompact', () => {
  it('should protect recent turn groups', () => {
    const messages: ProviderMessage[] = [
      makeTextMessage('user', 'first task'),
      makeToolUseMessage('tu_1', 'Read'),
      makeToolResultMessage('tu_1', 'A very long tool result that takes lots of space'),
      makeTextMessage('user', 'second task'),
      makeToolUseMessage('tu_2', 'Write'),
      makeToolResultMessage('tu_2', 'Another long result'),
    ];

    // Keep last 1 group (second task + tool use/result)
    const { messages: compacted, freedTokens } = microCompact(messages, 1);
    expect(freedTokens).toBeGreaterThan(0);

    // First group's tool result should be stubbed
    const firstToolResult = compacted[2]!.content[0] as any;
    expect(firstToolResult.content).toBe('[Previous tool result cleared to save context]');

    // Second group's tool result should be intact
    const secondToolResult = compacted[5]!.content[0] as any;
    expect(secondToolResult.content).toBe('Another long result');
  });

  it('should return 0 freedTokens when no tool results to clear', () => {
    const messages = [makeTextMessage('user', 'hi'), makeTextMessage('assistant', 'hello')];
    const { freedTokens } = microCompact(messages, 2);
    expect(freedTokens).toBe(0);
  });

  it('should not stub already-stubbed tool results', () => {
    const messages: ProviderMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: '[Previous tool result cleared to save context]',
          },
        ],
      },
      makeTextMessage('assistant', 'ok'),
      makeTextMessage('user', 'next'),
    ];
    const { freedTokens } = microCompact(messages, 1);
    expect(freedTokens).toBe(0);
  });
});

describe('truncateHeadForPTLRetry', () => {
  it('should return unchanged for single group', () => {
    const messages = [makeTextMessage('user', 'hello'), makeTextMessage('assistant', 'hi')];
    const result = truncateHeadForPTLRetry(messages, 10);
    expect(result.droppedGroups).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  it('should drop head groups to fit target tokens', () => {
    const messages: ProviderMessage[] = [
      makeTextMessage('user', 'x'.repeat(4000)), // ~1000 tokens
      makeTextMessage('assistant', 'response 1'),
      makeTextMessage('user', 'y'.repeat(4000)), // ~1000 tokens
      makeTextMessage('assistant', 'response 2'),
      makeTextMessage('user', 'z'.repeat(400)), // ~100 tokens
      makeTextMessage('assistant', 'response 3'),
    ];

    const result = truncateHeadForPTLRetry(messages, 500);
    expect(result.droppedGroups).toBeGreaterThan(0);
    // Should have prepended a truncation notice
    expect(result.messages[0]!.content[0]!.type).toBe('text');
    expect((result.messages[0]!.content[0] as any).text).toContain('Context truncated');
  });

  it('should always keep at least the last group', () => {
    const messages: ProviderMessage[] = [
      makeTextMessage('user', 'x'.repeat(40000)),
      makeTextMessage('assistant', 'response'),
    ];

    const result = truncateHeadForPTLRetry(messages, 1);
    // Can't drop the only group
    expect(result.droppedGroups).toBe(0);
  });
});

describe('postCompactCleanup', () => {
  it('should flag low quality summary', () => {
    const messages = [makeTextMessage('user', 'hello')];
    const result = postCompactCleanup(messages, 'short');
    expect(result.isLowQuality).toBe(true);
  });

  it('should not flag adequate summary', () => {
    const messages = [makeTextMessage('user', 'hello')];
    const longSummary = 'x'.repeat(300);
    const result = postCompactCleanup(messages, longSummary);
    expect(result.isLowQuality).toBe(false);
  });
});
