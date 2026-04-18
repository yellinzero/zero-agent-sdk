import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Output } from '../core/output.js';
import { AgentImpl } from '../loop/agent-impl.js';
import type {
  ModelInfo,
  ModelProvider,
  ProviderStreamEvent,
  StreamMessageParams,
} from '../providers/types.js';

const NATIVE_MODEL_INFO: ModelInfo = {
  contextWindow: 100_000,
  maxOutputTokens: 4_096,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: false,
  supportsPdfInput: false,
  supportsToolChoice: true,
  supportsResponseFormat: ['text', 'json_object', 'json_schema'],
  responseFormatStrategy: 'native',
};

const TOOL_SYNTHESIS_MODEL_INFO: ModelInfo = {
  contextWindow: 100_000,
  maxOutputTokens: 4_096,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: false,
  supportsPdfInput: false,
  supportsToolChoice: true,
  supportsResponseFormat: ['text'],
  responseFormatStrategy: 'tool-synthesis',
};

const TEXT_ONLY_MODEL_INFO: ModelInfo = {
  contextWindow: 100_000,
  maxOutputTokens: 4_096,
  supportsThinking: false,
  supportsToolUse: false,
  supportsImages: false,
  supportsPdfInput: false,
  supportsToolChoice: false,
  supportsResponseFormat: ['text'],
  responseFormatStrategy: 'none',
};

describe('fallback structured output state rebuild', () => {
  it('rebuilds response-format strategy and tool wiring after 529 fallback', async () => {
    let callCount = 0;
    const paramsSeen: StreamMessageParams[] = [];

    const provider: ModelProvider = {
      providerId: 'fallback-test',
      async *streamMessage(params) {
        paramsSeen.push(params);
        callCount++;
        if (callCount === 1) {
          const overloaded = new Error('overloaded') as Error & { status?: number };
          overloaded.status = 529;
          throw overloaded;
        }

        yield {
          type: 'message_start',
          usage: { inputTokens: 1, outputTokens: 0 },
        } satisfies ProviderStreamEvent;
        yield {
          type: 'content_block_start',
          index: 0,
          block: {
            type: 'tool_use',
            id: 'toolu_1',
            name: '__zero_sdk_structured_output__',
            input: {},
          },
        } satisfies ProviderStreamEvent;
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"answer":"42"}' },
        } satisfies ProviderStreamEvent;
        yield { type: 'content_block_stop', index: 0 } satisfies ProviderStreamEvent;
        yield {
          type: 'message_delta',
          stopReason: 'tool_use',
          usage: { inputTokens: 1, outputTokens: 1 },
        } satisfies ProviderStreamEvent;
        yield { type: 'message_stop' } satisfies ProviderStreamEvent;
      },
      async generateMessage() {
        return {
          id: 'x',
          model: 'x',
          content: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      getModelInfo(modelId) {
        return modelId === 'fallback-model' ? TOOL_SYNTHESIS_MODEL_INFO : NATIVE_MODEL_INFO;
      },
    };

    const agent = new AgentImpl({
      provider,
      model: 'primary-model',
      fallbackModel: 'fallback-model',
      maxConsecutive529s: 1,
    });

    const result = await agent.run('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    expect(result.output).toEqual({ answer: '42' });
    expect(paramsSeen).toHaveLength(2);
    expect(paramsSeen[0]?.responseFormat?.type).toBe('json_schema');
    expect(paramsSeen[1]?.responseFormat).toBeUndefined();
    expect(
      paramsSeen[1]?.tools?.some((tool) => tool.name === '__zero_sdk_structured_output__')
    ).toBe(true);
  });

  it('fails fast when fallback model cannot satisfy structured output', async () => {
    let callCount = 0;
    const provider: ModelProvider = {
      providerId: 'fallback-test',
      async *streamMessage() {
        callCount++;
        const overloaded = new Error('overloaded') as Error & { status?: number };
        overloaded.status = 529;
        if (callCount < 0) {
          yield {
            type: 'message_stop' as const,
          };
        }
        throw overloaded;
      },
      async generateMessage() {
        return {
          id: 'x',
          model: 'x',
          content: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      getModelInfo(modelId) {
        return modelId === 'fallback-model' ? TEXT_ONLY_MODEL_INFO : NATIVE_MODEL_INFO;
      },
    };

    const agent = new AgentImpl({
      provider,
      model: 'primary-model',
      fallbackModel: 'fallback-model',
      maxConsecutive529s: 1,
    });

    await expect(
      agent.run('answer', {
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
      })
    ).rejects.toMatchObject({
      name: 'AgentError',
      code: 'INVALID_CONFIG',
    });
    expect(callCount).toBe(1);
  });
});
