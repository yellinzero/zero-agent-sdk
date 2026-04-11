import { describe, expect, it } from 'vitest';
import type { ProviderMessage } from '../providers/types.js';
import { createMissingToolResults } from '../utils/messages.js';

function makeUserMessage(text: string): ProviderMessage {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function makeAssistantWithToolUse(toolUses: Array<{ id: string; name: string }>): ProviderMessage {
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
  toolResults: Array<{ tool_use_id: string; content: string }>
): ProviderMessage {
  return {
    role: 'user',
    content: toolResults.map((tr) => ({
      type: 'tool_result' as const,
      tool_use_id: tr.tool_use_id,
      content: tr.content,
    })),
  };
}

describe('createMissingToolResults', () => {
  it('should return empty array when no messages', () => {
    const results = createMissingToolResults([]);
    expect(results).toEqual([]);
  });

  it('should return empty array when no assistant messages', () => {
    const messages = [makeUserMessage('hello')];
    const results = createMissingToolResults(messages);
    expect(results).toEqual([]);
  });

  it('should return empty array when no tool_use in last assistant message', () => {
    const messages: ProviderMessage[] = [
      makeUserMessage('hello'),
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    const results = createMissingToolResults(messages);
    expect(results).toEqual([]);
  });

  it('should return empty array when all tool_use have matching tool_result', () => {
    const messages: ProviderMessage[] = [
      makeUserMessage('hello'),
      makeAssistantWithToolUse([{ id: 'tu_1', name: 'Read' }]),
      makeToolResultMessage([{ tool_use_id: 'tu_1', content: 'file content' }]),
    ];
    const results = createMissingToolResults(messages);
    expect(results).toEqual([]);
  });

  it('should generate synthetic result for unpaired tool_use', () => {
    const messages: ProviderMessage[] = [
      makeUserMessage('hello'),
      makeAssistantWithToolUse([
        { id: 'tu_1', name: 'Read' },
        { id: 'tu_2', name: 'Write' },
      ]),
    ];
    const results = createMissingToolResults(messages);
    expect(results).toHaveLength(2);
    expect(results[0]!.type).toBe('tool_result');
    expect(results[0]!.tool_use_id).toBe('tu_1');
    expect(results[0]!.is_error).toBe(true);
    expect(results[1]!.tool_use_id).toBe('tu_2');
  });

  it('should only generate synthetic result for unpaired tool_use', () => {
    const messages: ProviderMessage[] = [
      makeUserMessage('hello'),
      makeAssistantWithToolUse([
        { id: 'tu_1', name: 'Read' },
        { id: 'tu_2', name: 'Write' },
      ]),
      makeToolResultMessage([{ tool_use_id: 'tu_1', content: 'done' }]),
    ];
    const results = createMissingToolResults(messages);
    expect(results).toHaveLength(1);
    expect(results[0]!.tool_use_id).toBe('tu_2');
  });

  it('should use custom error message', () => {
    const messages: ProviderMessage[] = [
      makeUserMessage('hello'),
      makeAssistantWithToolUse([{ id: 'tu_1', name: 'Read' }]),
    ];
    const results = createMissingToolResults(messages, 'Custom error');
    expect(results[0]!.content).toBe('Custom error');
  });
});
