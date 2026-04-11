import { describe, expect, it } from 'vitest';
import { groupMessagesByApiRound } from '../context/message-groups.js';
import type { ProviderMessage } from '../providers/types.js';

function makeTextMessage(role: 'user' | 'assistant', text: string): ProviderMessage {
  return { role, content: [{ type: 'text', text }] };
}

function makeToolUseMessage(toolUses: Array<{ id: string; name: string }>): ProviderMessage {
  return {
    role: 'assistant',
    content: toolUses.map((tu) => ({
      type: 'tool_use' as const,
      id: tu.id,
      name: tu.name,
      input: {},
    })),
  };
}

function makeToolResultMessage(
  results: Array<{ tool_use_id: string; content: string }>
): ProviderMessage {
  return {
    role: 'user',
    content: results.map((r) => ({
      type: 'tool_result' as const,
      tool_use_id: r.tool_use_id,
      content: r.content,
    })),
  };
}

describe('groupMessagesByApiRound', () => {
  it('should return empty array for empty messages', () => {
    expect(groupMessagesByApiRound([])).toEqual([]);
  });

  it('should group a single user message', () => {
    const messages = [makeTextMessage('user', 'hello')];
    const groups = groupMessagesByApiRound(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.messages).toHaveLength(1);
  });

  it('should group user + assistant as one round', () => {
    const messages = [makeTextMessage('user', 'hello'), makeTextMessage('assistant', 'hi')];
    const groups = groupMessagesByApiRound(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.messages).toHaveLength(2);
  });

  it('should keep tool_use + tool_result in the same group', () => {
    const messages: ProviderMessage[] = [
      makeTextMessage('user', 'hello'),
      makeToolUseMessage([{ id: 'tu_1', name: 'Read' }]),
      makeToolResultMessage([{ tool_use_id: 'tu_1', content: 'result' }]),
    ];
    const groups = groupMessagesByApiRound(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.messages).toHaveLength(3);
    expect(groups[0]!.hasToolUse).toBe(true);
  });

  it('should start new group on user message without tool_result', () => {
    const messages: ProviderMessage[] = [
      makeTextMessage('user', 'first'),
      makeTextMessage('assistant', 'response'),
      makeTextMessage('user', 'second'),
      makeTextMessage('assistant', 'another response'),
    ];
    const groups = groupMessagesByApiRound(messages);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.messages).toHaveLength(2);
    expect(groups[1]!.messages).toHaveLength(2);
  });

  it('should not split tool_use/tool_result across groups', () => {
    const messages: ProviderMessage[] = [
      makeTextMessage('user', 'do something'),
      makeToolUseMessage([{ id: 'tu_1', name: 'Read' }]),
      makeToolResultMessage([{ tool_use_id: 'tu_1', content: 'result' }]),
      makeToolUseMessage([{ id: 'tu_2', name: 'Write' }]),
      makeToolResultMessage([{ tool_use_id: 'tu_2', content: 'done' }]),
      makeTextMessage('assistant', 'all done'),
      makeTextMessage('user', 'thanks'),
    ];
    const groups = groupMessagesByApiRound(messages);
    expect(groups).toHaveLength(2);
    // First group: user + tool_use + tool_result + tool_use + tool_result + assistant
    expect(groups[0]!.messages).toHaveLength(6);
    // Second group: user
    expect(groups[1]!.messages).toHaveLength(1);
  });

  it('should track tokenCount for each group', () => {
    const messages = [
      makeTextMessage('user', 'hello world'),
      makeTextMessage('assistant', 'hi there'),
    ];
    const groups = groupMessagesByApiRound(messages);
    expect(groups[0]!.tokenCount).toBeGreaterThan(0);
  });
});
