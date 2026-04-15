/**
 * tool_use_delta event — verifies partial tool-input JSON chunks are emitted
 * between tool_use_start and turn completion.
 */

import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../core/events.js';
import type { ModelProvider, ProviderStreamEvent } from '../providers/types.js';

function createToolStreamProvider(chunks: string[]): ModelProvider {
  return {
    providerId: 'test',
    async *streamMessage() {
      yield {
        type: 'message_start' as const,
        usage: { inputTokens: 10, outputTokens: 0 },
      } satisfies ProviderStreamEvent;

      yield {
        type: 'content_block_start' as const,
        index: 0,
        block: { type: 'tool_use' as const, id: 'tu_1', name: 'craft_recipe', input: {} },
      } satisfies ProviderStreamEvent;

      for (const chunk of chunks) {
        yield {
          type: 'content_block_delta' as const,
          index: 0,
          delta: { type: 'input_json_delta' as const, partial_json: chunk },
        } satisfies ProviderStreamEvent;
      }

      yield {
        type: 'content_block_stop' as const,
        index: 0,
      } satisfies ProviderStreamEvent;

      // stopReason 'end_turn' keeps the loop from attempting to execute the tool
      // (see query.ts: tools only run when stopReason === 'tool_use')
      yield {
        type: 'message_delta' as const,
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
      } satisfies ProviderStreamEvent;
    },
    async generateMessage() {
      return {
        content: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
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

async function runAgainst(provider: ModelProvider): Promise<AgentEvent[]> {
  const { agentLoop } = await import('../loop/query.js');
  const { createUserMessage } = await import('../utils/messages.js');

  const events: AgentEvent[] = [];
  for await (const event of agentLoop([createUserMessage('hi')], {
    provider,
    model: 'test-model',
    tools: [],
    maxTurns: 1,
    permissionMode: 'allowAll',
    cwd: '/tmp',
  })) {
    events.push(event);
  }
  return events;
}

describe('tool_use_delta event', () => {
  it('emits partial JSON chunks in order between start and turn end', async () => {
    const chunks = ['{"name":', '"iron_', 'sword","count":', '3}'];
    const provider = createToolStreamProvider(chunks);
    const events = await runAgainst(provider);

    const start = events.find((e) => e.type === 'tool_use_start');
    expect(start).toBeDefined();
    expect(start && start.type === 'tool_use_start' && start.toolName).toBe('craft_recipe');

    const deltas = events.filter(
      (e): e is Extract<AgentEvent, { type: 'tool_use_delta' }> => e.type === 'tool_use_delta'
    );
    expect(deltas.length).toBe(chunks.length);

    // Each delta carries exactly the provider chunk
    deltas.forEach((d, i) => {
      expect(d.partialJson).toBe(chunks[i]);
      expect(d.toolUseId).toBe('tu_1');
      expect(d.toolName).toBe('craft_recipe');
    });

    // accumulatedJson grows monotonically and equals the concat of all chunks
    expect(deltas[deltas.length - 1].accumulatedJson).toBe(chunks.join(''));
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i].accumulatedJson.startsWith(deltas[i - 1].accumulatedJson)).toBe(true);
    }

    // Start precedes all deltas in emission order
    const startIdx = events.findIndex((e) => e.type === 'tool_use_start');
    const firstDeltaIdx = events.findIndex((e) => e.type === 'tool_use_delta');
    expect(startIdx).toBeLessThan(firstDeltaIdx);
  });

  it('skips empty partial_json chunks', async () => {
    const chunks = ['{"name":"x"', '', '}'];
    const provider = createToolStreamProvider(chunks);
    const events = await runAgainst(provider);

    const deltas = events.filter((e) => e.type === 'tool_use_delta');
    // Two non-empty chunks -> two delta events
    expect(deltas.length).toBe(2);
  });

  it('still emits deltas when accumulated JSON is malformed', async () => {
    const chunks = ['{"broken":', ' not-json'];
    const provider = createToolStreamProvider(chunks);
    const events = await runAgainst(provider);

    const deltas = events.filter(
      (e): e is Extract<AgentEvent, { type: 'tool_use_delta' }> => e.type === 'tool_use_delta'
    );
    expect(deltas.length).toBe(chunks.length);
    expect(deltas[deltas.length - 1].accumulatedJson).toBe('{"broken": not-json');

    // No throw / unhandled error event from the delta path itself
    const loopError = events.find(
      (e) => e.type === 'error' && /tool_use_delta/i.test(e.error.message)
    );
    expect(loopError).toBeUndefined();
  });
});
