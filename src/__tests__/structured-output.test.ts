import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StructuredOutputError } from '../core/errors.js';
import { Output } from '../core/output.js';
import { AgentImpl } from '../loop/agent-impl.js';
import { AnthropicProvider } from '../providers/anthropic/client.js';
import { GenericOpenAICompatibleProvider } from '../providers/openai-compatible/generic.js';
import type {
  ModelInfo,
  ModelProvider,
  ProviderStreamEvent,
  StreamMessageParams,
} from '../providers/types.js';
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '../tools/structured-output.js';

// ---------------------------------------------------------------------------
// Provider request-shape tests (no agent loop involvement)
// ---------------------------------------------------------------------------

class TestableAnthropicProvider extends AnthropicProvider {
  public build(params: StreamMessageParams): Record<string, unknown> {
    return (
      this as unknown as { buildRequestParams: (p: StreamMessageParams) => Record<string, unknown> }
    ).buildRequestParams(params);
  }
}

class TestableOpenAICompatibleProvider extends GenericOpenAICompatibleProvider {
  public build(params: StreamMessageParams, stream = false): Record<string, unknown> {
    return (
      this as unknown as {
        buildRequestParams: (p: StreamMessageParams, s: boolean) => Record<string, unknown>;
      }
    ).buildRequestParams(params, stream);
  }
}

const baseParams: StreamMessageParams = {
  model: 'test-model',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  systemPrompt: 'You are a test.',
};

const schemaTool = {
  name: 'emit_result',
  description: 'Emit the structured result.',
  inputSchema: {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  },
};

describe('Anthropic structured output', () => {
  const provider = new TestableAnthropicProvider({ apiKey: 'sk-test' });

  it('maps toolChoice: auto to { type: "auto" }', () => {
    const req = provider.build({
      ...baseParams,
      tools: [schemaTool],
      toolChoice: { type: 'auto' },
    });
    expect(req.tool_choice).toEqual({ type: 'auto' });
    expect(req.tools).toHaveLength(1);
  });

  it('maps toolChoice: any to { type: "any" }', () => {
    const req = provider.build({
      ...baseParams,
      tools: [schemaTool],
      toolChoice: { type: 'any' },
    });
    expect(req.tool_choice).toEqual({ type: 'any' });
  });

  it('maps toolChoice: tool to { type: "tool", name }', () => {
    const req = provider.build({
      ...baseParams,
      tools: [schemaTool],
      toolChoice: { type: 'tool', name: 'emit_result' },
    });
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'emit_result' });
  });

  it('toolChoice: none drops the tools array and does not set tool_choice', () => {
    const req = provider.build({
      ...baseParams,
      tools: [schemaTool],
      toolChoice: { type: 'none' },
    });
    expect(req.tools).toBeUndefined();
    expect(req.tool_choice).toBeUndefined();
  });

  it('does not synthesize provider-local tools for json_schema responseFormat', () => {
    const req = provider.build({
      ...baseParams,
      responseFormat: {
        type: 'json_schema',
        name: 'result',
        description: 'Structured result',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
    });
    expect(req.tools).toBeUndefined();
    expect(req.tool_choice).toBeUndefined();
  });
});

describe('OpenAI-compatible structured output', () => {
  const provider = new TestableOpenAICompatibleProvider({
    providerId: 'test',
    baseUrl: 'http://localhost/v1',
    apiKey: 'sk-test',
    models: {
      'test-model': {
        contextWindow: 100_000,
        maxOutputTokens: 4_096,
        supportsThinking: false,
        supportsToolUse: true,
        supportsImages: false,
        supportsPdfInput: false,
        supportsToolChoice: true,
        supportsResponseFormat: ['text', 'json_object', 'json_schema'],
        responseFormatStrategy: 'native',
      },
    },
  });

  it('maps toolChoice: auto to "auto" string', () => {
    const req = provider.build({
      ...baseParams,
      tools: [schemaTool],
      toolChoice: { type: 'auto' },
    });
    expect(req.tool_choice).toBe('auto');
  });

  it('maps toolChoice: any to "required" string', () => {
    const req = provider.build({
      ...baseParams,
      tools: [schemaTool],
      toolChoice: { type: 'any' },
    });
    expect(req.tool_choice).toBe('required');
  });

  it('maps toolChoice: none to "none" string', () => {
    const req = provider.build({
      ...baseParams,
      tools: [schemaTool],
      toolChoice: { type: 'none' },
    });
    expect(req.tool_choice).toBe('none');
  });

  it('maps toolChoice: tool to { type: "function", function: { name } }', () => {
    const req = provider.build({
      ...baseParams,
      tools: [schemaTool],
      toolChoice: { type: 'tool', name: 'emit_result' },
    });
    expect(req.tool_choice).toEqual({
      type: 'function',
      function: { name: 'emit_result' },
    });
  });

  it('maps responseFormat: text to { type: "text" }', () => {
    const req = provider.build({
      ...baseParams,
      responseFormat: { type: 'text' },
    });
    expect(req.response_format).toEqual({ type: 'text' });
  });

  it('maps responseFormat: json_object to { type: "json_object" }', () => {
    const req = provider.build({
      ...baseParams,
      responseFormat: { type: 'json_object' },
    });
    expect(req.response_format).toEqual({ type: 'json_object' });
  });

  it('maps responseFormat: json_schema, preserving optional description and strict', () => {
    const schema = { type: 'object', properties: { answer: { type: 'string' } } };
    const req = provider.build({
      ...baseParams,
      responseFormat: {
        type: 'json_schema',
        name: 'result',
        schema,
        description: 'A result',
        strict: true,
      },
    });
    expect(req.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'result',
        schema,
        description: 'A result',
        strict: true,
      },
    });
  });

  it('omits tool_choice and response_format when neither is provided', () => {
    const req = provider.build({ ...baseParams, tools: [schemaTool] });
    expect(req).not.toHaveProperty('tool_choice');
    expect(req).not.toHaveProperty('response_format');
  });
});

// ---------------------------------------------------------------------------
// Output unit tests
// ---------------------------------------------------------------------------

describe('Output factory', () => {
  it('Output.enum accepts an exact match', () => {
    const out = Output.enum({ options: ['sunny', 'rainy'] as const });
    expect(out.parseFinal('{"result":"sunny"}')).toBe('sunny');
  });

  it('Output.enum rejects a value outside the allowed set', () => {
    const out = Output.enum({ options: ['sunny', 'rainy'] as const });
    expect(() => out.parseFinal('{"result":"snowy"}')).toThrow();
  });

  it('Output.enum partial parse stays silent on prefix ambiguity', () => {
    const out = Output.enum({ options: ['sunny', 'sundown'] as const });
    expect(out.parsePartial('{"result":"sun"}')).toEqual({});
  });

  it('Output.enum partial parse resolves a unique prefix', () => {
    const out = Output.enum({ options: ['sunny', 'cloudy'] as const });
    expect(out.parsePartial('{"result":"sun"}')).toEqual({ partial: 'sunny' });
  });

  it('Output.json parses arbitrary JSON', () => {
    expect(Output.json().parseFinal('{"value":1}')).toEqual({ value: 1 });
  });

  it('Output.json strips ```json fences', () => {
    expect(Output.json().parseFinal('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('Output.json extracts JSON from mixed prose', () => {
    expect(Output.json().parseFinal('Here is the result:\n{"value":1}\nThanks.')).toEqual({
      value: 1,
    });
  });

  it('Output.json rejects non-object top-level JSON', () => {
    // Output.json is constrained to JSON objects because json_object is
    // object-only across providers. Top-level arrays/scalars must use
    // Output.array or Output.object.
    expect(() => Output.json().parseFinal('[1,2,3]')).toThrow(/JSON object/);
    expect(() => Output.json().parseFinal('42')).toThrow(/JSON object/);
    expect(() => Output.json().parseFinal('"hi"')).toThrow(/JSON object/);
    expect(() => Output.json().parseFinal('null')).toThrow(/JSON object/);
  });

  it('Output.array throws on missing elements (no silent empty fallback)', () => {
    const out = Output.array({ element: z.object({ id: z.number() }) });
    expect(() => out.parseFinal('{}')).toThrow(/top-level array/i);
  });

  it('Output.array partial returns completed elements (excluding mid-stream tail)', () => {
    const out = Output.array({ element: z.object({ id: z.number() }) });
    const parsed = out.parsePartial('{"elements":[{"id":1},{"id":2},{"id":');
    expect(parsed.elements).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('Output.object validates against the supplied schema', () => {
    const out = Output.object({ schema: z.object({ name: z.string() }) });
    expect(out.parseFinal('{"name":"alice"}')).toEqual({ name: 'alice' });
    expect(() => out.parseFinal('{"name":42}')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test provider builders for agent-loop integration
// ---------------------------------------------------------------------------

const NATIVE_MODEL_INFO: ModelInfo = {
  contextWindow: 100_000,
  maxOutputTokens: 4_096,
  supportsImages: false,
  supportsToolUse: true,
  supportsToolChoice: true,
  supportsResponseFormat: ['text', 'json_object', 'json_schema'],
  responseFormatStrategy: 'native',
};

const TOOL_SYNTHESIS_MODEL_INFO: ModelInfo = {
  contextWindow: 100_000,
  maxOutputTokens: 4_096,
  supportsImages: false,
  supportsToolUse: true,
  supportsToolChoice: true,
  supportsResponseFormat: [],
  responseFormatStrategy: 'tool-synthesis',
};

interface ScriptedTextResponse {
  kind: 'text';
  chunks: string[];
}

interface ScriptedToolResponse {
  kind: 'tool';
  toolName?: string;
  jsonChunks: string[];
}

type ScriptedResponse = ScriptedTextResponse | ScriptedToolResponse;

function createScriptedProvider(
  modelInfo: ModelInfo,
  responses: ScriptedResponse[]
): ModelProvider {
  let callIndex = 0;
  return {
    providerId: 'scripted-test',
    async *streamMessage(params: StreamMessageParams) {
      const response = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;

      yield {
        type: 'message_start',
        usage: { inputTokens: 10, outputTokens: 0 },
      } satisfies ProviderStreamEvent;

      if (response.kind === 'text') {
        yield {
          type: 'content_block_start',
          index: 0,
          block: { type: 'text', text: '' },
        } satisfies ProviderStreamEvent;
        for (const chunk of response.chunks) {
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: chunk },
          } satisfies ProviderStreamEvent;
        }
        yield {
          type: 'content_block_stop',
          index: 0,
        } satisfies ProviderStreamEvent;
        yield {
          type: 'message_delta',
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 5 },
        } satisfies ProviderStreamEvent;
      } else {
        const toolName =
          response.toolName ??
          params.tools?.find((t) => t.name === SYNTHETIC_OUTPUT_TOOL_NAME)?.name ??
          SYNTHETIC_OUTPUT_TOOL_NAME;

        yield {
          type: 'content_block_start',
          index: 0,
          block: { type: 'tool_use', id: `toolu_${callIndex}`, name: toolName, input: {} },
        } satisfies ProviderStreamEvent;
        for (const chunk of response.jsonChunks) {
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: chunk },
          } satisfies ProviderStreamEvent;
        }
        yield {
          type: 'content_block_stop',
          index: 0,
        } satisfies ProviderStreamEvent;
        yield {
          type: 'message_delta',
          stopReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 5 },
        } satisfies ProviderStreamEvent;
      }

      yield { type: 'message_stop' } satisfies ProviderStreamEvent;
    },
    async generateMessage() {
      return {
        content: [{ type: 'text', text: '{}' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    getModelInfo() {
      return modelInfo;
    },
  };
}

// ---------------------------------------------------------------------------
// agent.run({ output }) — native path
// ---------------------------------------------------------------------------

describe('agent.run({ output }) — native responseFormat', () => {
  it('parses the final structured object', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(NATIVE_MODEL_INFO, [
        { kind: 'text', chunks: ['{"answer":"42"}'] },
      ]),
      model: 'test-model',
    });

    const result = await agent.run('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    expect(result.output).toEqual({ answer: '42' });
    expect(result.text).toBe('{"answer":"42"}');
  });

  it('throws StructuredOutputError(no_output) when the model returns nothing', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(NATIVE_MODEL_INFO, [{ kind: 'text', chunks: [''] }]),
      model: 'test-model',
    });

    const stream = agent.stream('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    await expect(stream.output).rejects.toMatchObject({
      name: 'StructuredOutputError',
      reason: 'no_output',
    });
  });

  it('throws StructuredOutputError(parse_failed) on malformed JSON', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(NATIVE_MODEL_INFO, [
        { kind: 'text', chunks: ['{ this is not json'] },
      ]),
      model: 'test-model',
    });

    const stream = agent.stream('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    await expect(stream.output).rejects.toMatchObject({
      name: 'StructuredOutputError',
      reason: 'parse_failed',
    });
  });

  it('throws StructuredOutputError(schema_mismatch) when JSON parses but fails validation', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(NATIVE_MODEL_INFO, [
        { kind: 'text', chunks: ['{"answer":42}'] },
      ]),
      model: 'test-model',
    });

    const stream = agent.stream('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    await expect(stream.output).rejects.toMatchObject({
      name: 'StructuredOutputError',
      reason: 'schema_mismatch',
    });
  });
});

// ---------------------------------------------------------------------------
// agent.stream({ output }) — partial / element streams
// ---------------------------------------------------------------------------

describe('agent.stream({ output }) — partial and element streams', () => {
  it('emits text deltas and a deduped partial for object output', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(NATIVE_MODEL_INFO, [
        { kind: 'text', chunks: ['{"answer":', '"42"}'] },
      ]),
      model: 'test-model',
    });

    const stream = agent.stream('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    const textChunks: string[] = [];
    for await (const chunk of stream.textStream) textChunks.push(chunk);

    const partials: Array<Record<string, unknown>> = [];
    for await (const partial of stream.partialOutputStream) {
      partials.push(partial as Record<string, unknown>);
    }

    expect(textChunks).toEqual(['{"answer":', '"42"}']);
    // Best-effort partials: the first chunk is structurally incomplete, the
    // second snapshots the final value. Both are deduped against each other.
    expect(partials.at(-1)).toEqual({ answer: '42' });
    expect(await stream.output).toEqual({ answer: '42' });
  });

  it('emits per-element events for array output via elementStream', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(NATIVE_MODEL_INFO, [
        {
          kind: 'text',
          chunks: ['{"elements":[', '{"id":1},', '{"id":2},', '{"id":3}]}'],
        },
      ]),
      model: 'test-model',
    });

    const stream = agent.stream('list', {
      output: Output.array({ element: z.object({ id: z.number() }) }),
    });

    const elements: Array<{ id: number }> = [];
    for await (const element of stream.elementStream) {
      elements.push(element as { id: number });
    }
    expect(elements).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(await stream.output).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('resets synthetic structured accumulators across turns', async () => {
    const provider = createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
      { kind: 'tool', jsonChunks: ['{"answer":1}'] },
      { kind: 'tool', jsonChunks: ['{"answer":"42"}'] },
    ]);
    const agent = new AgentImpl({
      provider,
      model: 'test-model',
      maxTurns: 2,
      maxStructuredOutputRepairs: 1,
    });

    const result = await agent.run('answer in two turns', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    expect(result.output).toEqual({ answer: '42' });
  });

  it('does not emit duplicate partials for structurally identical snapshots', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(NATIVE_MODEL_INFO, [
        // Trailing whitespace/no-op chunks should not produce new partials.
        { kind: 'text', chunks: ['{"a":1}', '   ', '\n'] },
      ]),
      model: 'test-model',
    });

    const stream = agent.stream('x', { output: Output.json() });

    const partials: unknown[] = [];
    for await (const p of stream.partialOutputStream) partials.push(p);

    expect(partials).toEqual([{ a: 1 }]);
  });

  it('rejects output and partial streams on abort', async () => {
    const provider: ModelProvider = {
      providerId: 'abort-test',
      async *streamMessage(params: StreamMessageParams) {
        yield {
          type: 'message_start',
          usage: { inputTokens: 1, outputTokens: 0 },
        } satisfies ProviderStreamEvent;
        yield {
          type: 'content_block_start',
          index: 0,
          block: { type: 'text', text: '' },
        } satisfies ProviderStreamEvent;
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '{"answer":' },
        } satisfies ProviderStreamEvent;
        throw params.signal?.reason ?? new Error('aborted');
      },
      async generateMessage() {
        return {
          id: 'abort',
          model: 'abort-model',
          content: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      getModelInfo() {
        return NATIVE_MODEL_INFO;
      },
    };

    const controller = new AbortController();
    const agent = new AgentImpl({
      provider,
      model: 'abort-model',
    });

    const stream = agent.stream('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
      signal: controller.signal,
    });
    controller.abort(new Error('manual abort'));

    await expect(stream.output).rejects.toBeInstanceOf(Error);
    await expect(
      (async () => {
        for await (const _partial of stream.partialOutputStream) {
          // exhaust
        }
      })()
    ).rejects.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Tool-synthesis path
// ---------------------------------------------------------------------------

describe('agent.run({ output }) — tool-synthesis path', () => {
  it('captures the synthetic tool input as the final structured value', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
        { kind: 'tool', jsonChunks: ['{"answer":', '"42"}'] },
      ]),
      model: 'test-model',
    });

    const result = await agent.run('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    expect(result.output).toEqual({ answer: '42' });
  });

  it('repairs once and succeeds on the second attempt', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
        // First call: invalid (answer must be a string).
        { kind: 'tool', jsonChunks: ['{"answer":42}'] },
        // Second call: valid.
        { kind: 'tool', jsonChunks: ['{"answer":"42"}'] },
      ]),
      model: 'test-model',
      maxStructuredOutputRepairs: 1,
    });

    const result = await agent.run('answer', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    expect(result.output).toEqual({ answer: '42' });
  });

  it('throws StructuredOutputError(max_repairs) once the budget is exhausted', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
        { kind: 'tool', jsonChunks: ['{"answer":1}'] },
        { kind: 'tool', jsonChunks: ['{"answer":2}'] },
        { kind: 'tool', jsonChunks: ['{"answer":3}'] },
      ]),
      model: 'test-model',
      maxStructuredOutputRepairs: 1,
    });

    await expect(
      agent.run('answer', {
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
      })
    ).rejects.toMatchObject({
      name: 'StructuredOutputError',
      reason: 'max_repairs',
    });
  });

  it('attaches repair history and attempts to the StructuredOutputError', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
        { kind: 'tool', jsonChunks: ['{"answer":1}'] },
        { kind: 'tool', jsonChunks: ['{"answer":2}'] },
        { kind: 'tool', jsonChunks: ['{"answer":3}'] },
      ]),
      model: 'test-model',
      maxStructuredOutputRepairs: 1,
    });

    let captured: StructuredOutputError | undefined;
    try {
      await agent.run('answer', {
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
      });
    } catch (err) {
      if (err instanceof StructuredOutputError) captured = err;
    }

    expect(captured).toBeDefined();
    expect(captured?.attempts).toBe(2);
    expect(captured?.repairHistory?.length).toBe(2);
    expect(captured?.repairHistory?.[0]).toMatch(/Schema validation failed/);
  });

  it('rejects combining toolChoice with tool-synthesis output', async () => {
    const agent = new AgentImpl({
      provider: createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
        { kind: 'tool', jsonChunks: ['{"answer":"x"}'] },
      ]),
      model: 'test-model',
      toolChoice: { type: 'auto' },
    });

    await expect(
      agent.run('x', {
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
      })
    ).rejects.toThrow(/toolChoice/);
  });

  it('rejects per-run toolChoice with tool-synthesis output as INVALID_CONFIG', async () => {
    // A per-run toolChoice override must be caught by the fail-fast validation
    // path (INVALID_CONFIG), not leak into the loop and surface as a
    // structured-output schema_mismatch error.
    const agent = new AgentImpl({
      provider: createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
        { kind: 'tool', jsonChunks: ['{"answer":"x"}'] },
      ]),
      model: 'test-model',
    });

    let captured: unknown;
    try {
      await agent.run('x', {
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
        toolChoice: { type: 'auto' },
      });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeDefined();
    expect((captured as { code?: string }).code).toBe('INVALID_CONFIG');
    expect((captured as { name?: string }).name).not.toBe('StructuredOutputError');
    expect((captured as Error).message).toMatch(/toolChoice/);
  });

  it('allows user tools with structuredOutputMode=mixed on synthesis providers', async () => {
    const requestedToolChoices: Array<StreamMessageParams['toolChoice']> = [];
    const provider = createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
      { kind: 'tool', toolName: 'lookup_value', jsonChunks: ['{"query":"x"}'] },
      { kind: 'tool', jsonChunks: ['{"answer":"42"}'] },
    ]);
    const wrappedProvider: ModelProvider = {
      ...provider,
      async *streamMessage(params) {
        requestedToolChoices.push(params.toolChoice);
        yield* provider.streamMessage(params);
      },
    };

    const agent = new AgentImpl({
      provider: wrappedProvider,
      model: 'test-model',
      structuredOutputMode: 'mixed',
      tools: [
        {
          name: 'lookup_value',
          inputSchema: z.object({ query: z.string() }),
          async call() {
            return { data: { ok: true } };
          },
          async description() {
            return 'Lookup a value.';
          },
          async prompt() {
            return 'Lookup a value.';
          },
          async checkPermissions() {
            return { behavior: 'allow' as const };
          },
          isConcurrencySafe() {
            return true;
          },
          isReadOnly() {
            return true;
          },
          isEnabled() {
            return true;
          },
          mapToolResult() {
            return {
              type: 'tool_result' as const,
              tool_use_id: 'lookup',
              content: 'ok',
            };
          },
        },
      ],
    });

    const result = await agent.run('mixed mode', {
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    expect(result.output).toEqual({ answer: '42' });
    expect(requestedToolChoices[0]).toEqual({ type: 'any' });
  });

  it('surfaces non-schema synthetic tool failures immediately (no repair)', async () => {
    // preToolUse hook blocks the synthetic tool. This is a configuration
    // issue, not an output-shape issue — the loop should not spin through
    // the repair budget re-asking the model. It should fail immediately.
    const agent = new AgentImpl({
      provider: createScriptedProvider(TOOL_SYNTHESIS_MODEL_INFO, [
        { kind: 'tool', jsonChunks: ['{"answer":"x"}'] },
        { kind: 'tool', jsonChunks: ['{"answer":"x"}'] },
        { kind: 'tool', jsonChunks: ['{"answer":"x"}'] },
      ]),
      model: 'test-model',
      maxStructuredOutputRepairs: 5,
      hooks: {
        preToolUse: [
          async ({ toolName }) => {
            if (toolName === SYNTHETIC_OUTPUT_TOOL_NAME) {
              return { continue: false, stopReason: 'blocked for test' };
            }
            return {};
          },
        ],
      },
    });

    let captured: unknown;
    try {
      await agent.run('x', {
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
      });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeDefined();
    expect((captured as { name?: string }).name).toBe('ToolExecutionError');
    // max_repairs should never trigger — we bailed out on the very first hook
    // block rather than re-asking the model up to maxStructuredOutputRepairs.
    expect((captured as { name?: string }).name).not.toBe('StructuredOutputError');
    expect((captured as Error).message).toMatch(/blocked for test/);
  });
});
