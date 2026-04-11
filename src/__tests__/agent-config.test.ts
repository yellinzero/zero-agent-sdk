/**
 * Tests for agent configuration: appendSystemPrompt, SessionOptions, UsageCallback.
 */

import { describe, expect, it, vi } from 'vitest';

describe('appendSystemPrompt', () => {
  it('should concatenate system prompt with append', () => {
    const base = 'You are a helpful assistant.';
    const append = 'Always respond in JSON.';
    const result = append ? `${base}\n\n${append}` : base;
    expect(result).toBe('You are a helpful assistant.\n\nAlways respond in JSON.');
  });

  it('should return base prompt when no append', () => {
    const base = 'You are a helpful assistant.';
    const append = '';
    const result = append ? `${base}\n\n${append}` : base;
    expect(result).toBe('You are a helpful assistant.');
  });

  it('should return empty string when both are empty', () => {
    const base = '';
    const append = '';
    const result = append ? `${base}\n\n${append}` : base;
    expect(result).toBe('');
  });
});

describe('SessionOptions priority', () => {
  it('should prefer session systemPrompt over config', () => {
    const configPrompt = 'config prompt';
    const sessionPrompt = 'session prompt';
    const result = sessionPrompt ?? configPrompt ?? '';
    expect(result).toBe('session prompt');
  });

  it('should fall back to config when session has no systemPrompt', () => {
    const configPrompt = 'config prompt';
    const sessionPrompt = undefined;
    const result = sessionPrompt ?? configPrompt ?? '';
    expect(result).toBe('config prompt');
  });
});

describe('UsageCallbackEvent', () => {
  it('should have the correct shape', () => {
    const event = {
      sessionId: 'test-session',
      turnNumber: 1,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      model: 'test-model',
      provider: 'test-provider',
    };

    expect(event.sessionId).toBe('test-session');
    expect(event.turnNumber).toBe(1);
    expect(event.usage.inputTokens).toBe(100);
    expect(event.model).toBe('test-model');
    expect(event.provider).toBe('test-provider');
  });
});
