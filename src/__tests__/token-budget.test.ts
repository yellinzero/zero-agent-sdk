/**
 * Token budget test — verifies that maxTokens is enforced in the agent loop.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../core/events.js';
import type { ModelProvider, ProviderStreamEvent } from '../providers/types.js';

// Create a mock provider that yields a simple text response
function createMockProvider(inputTokens: number, outputTokens: number): ModelProvider {
  return {
    providerId: 'test',
    async *streamMessage() {
      yield {
        type: 'message_start' as const,
        usage: { inputTokens, outputTokens: 0 },
      } satisfies ProviderStreamEvent;

      yield {
        type: 'content_block_start' as const,
        index: 0,
        block: { type: 'text' as const, text: '' },
      } satisfies ProviderStreamEvent;

      yield {
        type: 'content_block_delta' as const,
        index: 0,
        delta: { type: 'text_delta' as const, text: 'Hello' },
      } satisfies ProviderStreamEvent;

      yield {
        type: 'content_block_stop' as const,
        index: 0,
      } satisfies ProviderStreamEvent;

      yield {
        type: 'message_delta' as const,
        stopReason: 'end_turn',
        usage: { inputTokens, outputTokens },
      } satisfies ProviderStreamEvent;
    },
    async generateMessage() {
      return {
        content: [{ type: 'text' as const, text: 'Hello' }],
        stopReason: 'end_turn',
        usage: { inputTokens, outputTokens },
      };
    },
    getModelInfo() {
      return {
        contextWindow: 100_000,
        maxOutputTokens: 4_096,
        supportsImages: false,
        supportsToolUse: true,
        inputTokenCostPer1M: 1.0,
        outputTokenCostPer1M: 5.0,
      };
    },
  };
}

describe('Token budget enforcement', () => {
  it('stops when maxTokens is exceeded', async () => {
    // Dynamic import to avoid module-level side effects
    const { agentLoop } = await import('../loop/query.js');
    const { createUserMessage } = await import('../utils/messages.js');

    const provider = createMockProvider(5000, 5000);
    const messages = [createUserMessage('Hello')];

    const events: AgentEvent[] = [];
    for await (const event of agentLoop(messages, {
      provider,
      model: 'test-model',
      tools: [],
      maxTurns: 10,
      maxTokens: 8000, // Budget of 8000, but we'll use 10000
      permissionMode: 'allowAll',
      cwd: '/tmp',
    })) {
      events.push(event);
    }

    // Should have a budget exceeded error
    const errorEvent = events.find(
      (e) => e.type === 'error' && e.error.message.includes('Token budget exceeded')
    );
    expect(errorEvent).toBeDefined();

    // Should have a turn_end with budget_exceeded
    const turnEnd = events.find((e) => e.type === 'turn_end' && e.stopReason === 'budget_exceeded');
    expect(turnEnd).toBeDefined();
  });

  it('continues when within maxTokens budget', async () => {
    const { agentLoop } = await import('../loop/query.js');
    const { createUserMessage } = await import('../utils/messages.js');

    const provider = createMockProvider(500, 500);
    const messages = [createUserMessage('Hello')];

    const events: AgentEvent[] = [];
    for await (const event of agentLoop(messages, {
      provider,
      model: 'test-model',
      tools: [],
      maxTurns: 1,
      maxTokens: 100_000, // Well within budget
      permissionMode: 'allowAll',
      cwd: '/tmp',
    })) {
      events.push(event);
    }

    // Should NOT have budget exceeded error
    const errorEvent = events.find(
      (e) => e.type === 'error' && e.error.message.includes('Token budget exceeded')
    );
    expect(errorEvent).toBeUndefined();
  });
});
