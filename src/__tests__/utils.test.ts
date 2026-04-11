import { describe, expect, it } from 'vitest';
import {
  createAssistantMessage,
  createUserMessage,
  extractText,
  hasToolUse,
} from '../utils/messages.js';
import {
  addUsage,
  emptyUsage,
  estimateMessagesTokenCount,
  estimateTokenCount,
} from '../utils/tokens.js';

describe('tokens', () => {
  describe('emptyUsage', () => {
    it('should return all zeros', () => {
      const usage = emptyUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
    });
  });

  describe('addUsage', () => {
    it('should add two usage objects', () => {
      const a = { inputTokens: 100, outputTokens: 50 };
      const b = { inputTokens: 200, outputTokens: 75 };
      const result = addUsage(a, b);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(125);
    });
  });

  describe('estimateTokenCount', () => {
    it('should estimate ~4 chars per token', () => {
      const estimate = estimateTokenCount('hello world'); // 11 chars
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThan(11); // Should be less than char count
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokenCount('')).toBe(0);
    });
  });

  describe('estimateMessagesTokenCount', () => {
    it('should estimate tokens across messages', () => {
      const messages = [
        createUserMessage('Hello, how are you?'),
        createAssistantMessage('I am doing well, thank you for asking.'),
      ];
      const count = estimateMessagesTokenCount(messages);
      expect(count).toBeGreaterThan(0);
    });
  });
});

describe('messages', () => {
  describe('createUserMessage', () => {
    it('should create a user message with text content', () => {
      const msg = createUserMessage('hello');
      expect(msg.role).toBe('user');
      expect(msg.content).toHaveLength(1);
      expect(msg.content[0]).toEqual({ type: 'text', text: 'hello' });
    });
  });

  describe('createAssistantMessage', () => {
    it('should create an assistant message with text content', () => {
      const msg = createAssistantMessage('world');
      expect(msg.role).toBe('assistant');
      expect(msg.content).toHaveLength(1);
      expect(msg.content[0]).toEqual({ type: 'text', text: 'world' });
    });
  });

  describe('extractText', () => {
    it('should extract text from content blocks', () => {
      const msg = createAssistantMessage('hello world');
      expect(extractText(msg)).toBe('hello world');
    });

    it('should skip non-text blocks', () => {
      const msg = {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'hello' },
          { type: 'tool_use' as const, id: '1', name: 'Bash', input: {} },
          { type: 'text' as const, text: ' world' },
        ],
      };
      expect(extractText(msg)).toBe('hello world');
    });
  });

  describe('hasToolUse', () => {
    it('should return true when content has tool_use blocks', () => {
      const msg = {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'hello' },
          { type: 'tool_use' as const, id: '1', name: 'Bash', input: {} },
        ],
      };
      expect(hasToolUse(msg)).toBe(true);
    });

    it('should return false when no tool_use blocks', () => {
      const msg = createAssistantMessage('hello');
      expect(hasToolUse(msg)).toBe(false);
    });
  });
});
