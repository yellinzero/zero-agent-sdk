/**
 * Open Responses provider implementation.
 *
 * Implements the "Open Responses API" protocol — a standard for AI model
 * endpoints using the `/v1/responses` path. Uses raw `fetch` with no
 * external SDK dependency.
 *
 * Protocol handling is informed by the public Open Responses reference:
 * https://github.com/vercel/ai/tree/main/packages/open-responses
 */

import { ProviderError } from '../../core/errors.js';
import type {
  GenerateMessageParams,
  ModelInfo,
  ModelProvider,
  ProviderContentBlock,
  ProviderDelta,
  ProviderMessage,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderToolSchema,
  ProviderUsage,
  ResponseFormat,
  StreamMessageParams,
  SystemPromptBlock,
  ToolChoice,
} from '../types.js';
import { OPEN_RESPONSES_DEFAULT_MODEL_INFO } from './models.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OpenResponsesProviderConfig {
  /** Display name for the provider (also used as `providerId`). */
  name: string;

  /** Full URL to the responses endpoint, e.g. "http://localhost:1234/v1/responses". */
  url: string;

  /** Optional API key (sent as Bearer token). */
  apiKey?: string;

  /** Default headers merged into every request. */
  headers?: Record<string, string>;

  /** Custom fetch implementation (defaults to `globalThis.fetch`). */
  fetch?: typeof globalThis.fetch;

  /** Model info to use for all models served by this endpoint. */
  defaultModelInfo?: ModelInfo;
}

// ---------------------------------------------------------------------------
// Open Responses API types (request / response shapes)
// ---------------------------------------------------------------------------

/** A single input item in the Open Responses request. */
type InputItem =
  | { type: 'message'; role: 'user'; content: InputContent[] }
  | { type: 'message'; role: 'assistant'; content: AssistantContent[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

type InputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: string }
  | { type: 'input_file'; file_data: string };

type AssistantContent =
  | { type: 'output_text'; text: string }
  | { type: 'refusal'; refusal: string };

interface FunctionToolParam {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface OpenResponsesRequestBody {
  model: string;
  input: InputItem[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: FunctionToolParam[];
  tool_choice?: string | { type: 'function'; name: string };
  text?: { format?: OpenResponsesTextFormat };
  reasoning?: { effort?: string };
  stream?: boolean;
}

type OpenResponsesTextFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      name: string;
      description?: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };

/** An output item from the API response. */
interface OutputItem {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  role?: string;
  status?: string;
  content?: Array<{ type: string; text: string }>;
  summary?: Array<{ type: string; text: string }>;
}

interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

interface OpenResponsesResponseBody {
  id: string;
  object: string;
  status: string;
  model: string;
  output: OutputItem[];
  usage?: ResponseUsage;
  incomplete_details?: { reason?: string };
  error?: { code: string; message: string };
}

/** SSE event parsed from the stream (loosely typed). */
interface SSEEvent {
  type: string;
  response?: OpenResponsesResponseBody;
  item?: OutputItem;
  output_index?: number;
  item_id?: string;
  delta?: string;
  arguments?: string;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Streaming state
// ---------------------------------------------------------------------------

interface StreamState {
  blockIndex: number;
  messageStarted: boolean;
  responseCompleted: boolean;
  hasToolCalls: boolean;
  /** Maps item id → accumulated tool call info. */
  toolCalls: Record<
    string,
    {
      name: string;
      callId: string;
      arguments: string;
      blockIndex: number;
    }
  >;
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class OpenResponsesProvider implements ModelProvider {
  readonly providerId: string;

  private readonly config: OpenResponsesProviderConfig;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly modelInfo: ModelInfo;

  constructor(config: OpenResponsesProviderConfig) {
    this.providerId = config.name;
    this.config = config;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.modelInfo = config.defaultModelInfo ?? OPEN_RESPONSES_DEFAULT_MODEL_INFO;
  }

  // -------------------------------------------------------------------------
  // ModelProvider interface
  // -------------------------------------------------------------------------

  getModelInfo(_modelId: string): ModelInfo {
    return {
      ...this.modelInfo,
      supportsToolChoice: this.modelInfo.supportsToolChoice ?? true,
      supportsResponseFormat: this.modelInfo.supportsResponseFormat ?? [
        'text',
        'json_object',
        'json_schema',
      ],
      responseFormatStrategy: this.modelInfo.responseFormatStrategy ?? 'native',
    };
  }

  async *streamMessage(params: StreamMessageParams): AsyncGenerator<ProviderStreamEvent> {
    const body = this.buildRequestBody(params, true);
    const response = await this.doFetch(body, params.signal);

    if (!response.body) {
      throw new ProviderError('Response body is null', response.status, this.providerId);
    }

    yield* this.parseSSEStream(response.body, params.signal);
  }

  async generateMessage(params: GenerateMessageParams): Promise<ProviderResponse> {
    const body = this.buildRequestBody(params, false);
    const response = await this.doFetch(body, params.signal);
    const data = (await response.json()) as OpenResponsesResponseBody;

    if (data.error) {
      throw new ProviderError(data.error.message, undefined, this.providerId);
    }

    return this.mapResponseBody(data);
  }

  // -------------------------------------------------------------------------
  // Request building
  // -------------------------------------------------------------------------

  private buildRequestBody(params: StreamMessageParams, stream: boolean): OpenResponsesRequestBody {
    const input = this.convertMessages(params.messages);
    const instructions = this.resolveSystemPrompt(params.systemPrompt);
    const tools = params.tools?.map((t) => this.convertTool(t));
    const reasoning = this.resolveReasoning(params);

    const body: OpenResponsesRequestBody = {
      model: params.model,
      input,
      stream,
    };

    if (instructions) body.instructions = instructions;
    if (params.maxOutputTokens != null) body.max_output_tokens = params.maxOutputTokens;
    if (params.temperature != null) body.temperature = params.temperature;
    if (params.topP != null) body.top_p = params.topP;
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    // tool_choice — only meaningful when tools are present (or forcibly 'none')
    if (params.toolChoice) {
      const mapped = this.mapToolChoice(params.toolChoice);
      if (mapped !== undefined) body.tool_choice = mapped;
    }

    // responseFormat — Open Responses spec uses the `text.format` field.
    if (params.responseFormat) {
      const mapped = this.mapResponseFormat(params.responseFormat);
      if (mapped !== undefined) body.text = { format: mapped };
    }

    if (reasoning) body.reasoning = reasoning;

    return body;
  }

  private mapToolChoice(
    choice: ToolChoice
  ): string | { type: 'function'; name: string } | undefined {
    switch (choice.type) {
      case 'auto':
        return 'auto';
      case 'any':
        return 'required';
      case 'none':
        return 'none';
      case 'tool':
        return { type: 'function', name: choice.name };
    }
  }

  private mapResponseFormat(format: ResponseFormat): OpenResponsesTextFormat | undefined {
    switch (format.type) {
      case 'text':
        return { type: 'text' };
      case 'json_object':
        return { type: 'json_object' };
      case 'json_schema':
        return {
          type: 'json_schema',
          name: format.name,
          schema: format.schema,
          ...(format.description !== undefined ? { description: format.description } : {}),
          ...(format.strict !== undefined ? { strict: format.strict } : {}),
        };
    }
  }

  /** Convert `ProviderMessage[]` to Open Responses `input` array. */
  private convertMessages(messages: ProviderMessage[]): InputItem[] {
    const input: InputItem[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const userContent: InputContent[] = [];
        const toolResults: InputItem[] = [];

        for (const block of msg.content) {
          switch (block.type) {
            case 'text':
              userContent.push({ type: 'input_text', text: block.text });
              break;
            case 'image':
              userContent.push({
                type: 'input_image',
                image_url: `data:${block.source.media_type};base64,${block.source.data}`,
              });
              break;
            case 'document':
              userContent.push({
                type: 'input_file',
                file_data: `data:${block.source.media_type};base64,${block.source.data}`,
              });
              break;
            case 'tool_result': {
              const output =
                typeof block.content === 'string'
                  ? block.content
                  : this.extractTextFromBlocks(block.content);
              toolResults.push({
                type: 'function_call_output',
                call_id: block.tool_use_id,
                output,
              });
              break;
            }
          }
        }

        if (userContent.length > 0) {
          input.push({ type: 'message', role: 'user', content: userContent });
        }
        for (const tr of toolResults) {
          input.push(tr);
        }
      } else if (msg.role === 'assistant') {
        const assistantContent: AssistantContent[] = [];
        const functionCalls: InputItem[] = [];

        for (const block of msg.content) {
          switch (block.type) {
            case 'text':
              assistantContent.push({ type: 'output_text', text: block.text });
              break;
            case 'tool_use':
              functionCalls.push({
                type: 'function_call',
                call_id: block.id,
                name: block.name,
                arguments:
                  typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
              });
              break;
            // thinking / redacted_thinking blocks are not sent back to the API
          }
        }

        if (assistantContent.length > 0) {
          input.push({ type: 'message', role: 'assistant', content: assistantContent });
        }
        for (const fc of functionCalls) {
          input.push(fc);
        }
      }
    }

    return input;
  }

  /** Convert `ProviderToolSchema` to Open Responses `FunctionToolParam`. */
  private convertTool(tool: ProviderToolSchema): FunctionToolParam {
    return {
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    };
  }

  /** Resolve `systemPrompt` to a single string for the `instructions` field. */
  private resolveSystemPrompt(systemPrompt: string | SystemPromptBlock[]): string | undefined {
    if (typeof systemPrompt === 'string') {
      return systemPrompt || undefined;
    }
    const joined = systemPrompt.map((b) => b.text).join('\n');
    return joined || undefined;
  }

  /** Map thinking config to Open Responses `reasoning` parameter. */
  private resolveReasoning(params: StreamMessageParams): { effort: string } | undefined {
    if (params.thinkingConfig?.type !== 'enabled') return undefined;
    const budget = params.thinkingConfig.budgetTokens;
    if (!budget) return { effort: 'medium' };
    if (budget >= 20_000) return { effort: 'high' };
    if (budget >= 5_000) return { effort: 'medium' };
    return { effort: 'low' };
  }

  /** Extract plain text from a `ProviderContentBlock[]`. */
  private extractTextFromBlocks(blocks: ProviderContentBlock[]): string {
    return blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async doFetch(body: OpenResponsesRequestBody, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await this.fetchFn(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorBody = (await response.json()) as { error?: { message?: string } };
        if (errorBody?.error?.message) {
          errorMessage = errorBody.error.message;
        }
      } catch {
        // ignore parse errors
      }
      throw new ProviderError(errorMessage, response.status, this.providerId);
    }

    return response;
  }

  // -------------------------------------------------------------------------
  // Non-streaming response mapping
  // -------------------------------------------------------------------------

  private mapResponseBody(data: OpenResponsesResponseBody): ProviderResponse {
    const content: ProviderContentBlock[] = [];
    let hasToolCalls = false;

    for (const item of data.output) {
      switch (item.type) {
        case 'reasoning': {
          const reasoningText = (item.content ?? []).map((c) => c.text).join('');
          if (reasoningText) {
            content.push({ type: 'thinking', thinking: reasoningText });
          }
          break;
        }
        case 'message': {
          for (const part of item.content ?? []) {
            if (part.type === 'output_text') {
              content.push({ type: 'text', text: part.text });
            }
          }
          break;
        }
        case 'function_call': {
          hasToolCalls = true;
          let parsedInput: unknown;
          try {
            parsedInput = JSON.parse(item.arguments ?? '{}');
          } catch {
            parsedInput = item.arguments ?? '';
          }
          content.push({
            type: 'tool_use',
            id: item.call_id ?? item.id ?? '',
            name: item.name ?? '',
            input: parsedInput,
          });
          break;
        }
      }
    }

    const stopReason = this.mapStopReason(data, hasToolCalls);
    const usage = this.mapUsage(data.usage);

    return {
      id: data.id,
      model: data.model,
      content,
      stopReason,
      usage,
    };
  }

  // -------------------------------------------------------------------------
  // SSE streaming
  // -------------------------------------------------------------------------

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const state: StreamState = {
      blockIndex: 0,
      messageStarted: false,
      responseCompleted: false,
      hasToolCalls: false,
      toolCalls: {},
    };

    try {
      while (true) {
        if (signal?.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;

            let event: SSEEvent;
            try {
              event = JSON.parse(data) as SSEEvent;
            } catch {
              continue;
            }

            yield* this.handleSSEEvent(event, state);
          }
        }
      }

      // If we never got a response.completed, still close out
      if (!state.responseCompleted) {
        yield {
          type: 'message_delta',
          stopReason: state.hasToolCalls ? 'tool_use' : 'end_turn',
        };
        yield { type: 'message_stop' };
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle a single SSE event — yields `ProviderStreamEvent`s and mutates
   * `state` as a side-effect for tracking block indices, tool calls, etc.
   */
  private *handleSSEEvent(event: SSEEvent, state: StreamState): Generator<ProviderStreamEvent> {
    switch (event.type) {
      // -- Response lifecycle ------------------------------------------------
      case 'response.created':
      case 'response.in_progress': {
        if (!state.messageStarted) {
          yield {
            type: 'message_start',
            messageId: event.response?.id,
            model: event.response?.model,
          };
          state.messageStarted = true;
        }
        break;
      }

      // -- Output item added -------------------------------------------------
      case 'response.output_item.added': {
        const item = event.item;
        if (!item) break;
        const outputIndex = event.output_index ?? 0;

        if (item.type === 'message') {
          const idx = state.blockIndex;
          yield {
            type: 'content_block_start',
            index: idx,
            block: { type: 'text', text: '' },
          };
          state.blockIndex = idx + 1;
        } else if (item.type === 'function_call') {
          const idx = state.blockIndex;
          const callId = item.call_id ?? item.id ?? '';
          const name = item.name ?? '';
          state.toolCalls[item.id ?? `fc_${outputIndex}`] = {
            name,
            callId,
            arguments: item.arguments ?? '',
            blockIndex: idx,
          };
          yield {
            type: 'content_block_start',
            index: idx,
            block: { type: 'tool_use', id: callId, name, input: {} },
          };
          state.blockIndex = idx + 1;
          state.hasToolCalls = true;
        } else if (item.type === 'reasoning') {
          const idx = state.blockIndex;
          yield {
            type: 'content_block_start',
            index: idx,
            block: { type: 'thinking', thinking: '' },
          };
          state.blockIndex = idx + 1;
        }
        break;
      }

      // -- Text delta ---------------------------------------------------------
      case 'response.output_text.delta': {
        const delta = event.delta ?? '';
        yield {
          type: 'content_block_delta',
          index: Math.max(0, state.blockIndex - 1),
          delta: { type: 'text_delta', text: delta } as ProviderDelta,
        };
        break;
      }

      // -- Reasoning text delta (LM Studio extension) -------------------------
      case 'response.reasoning_text.delta': {
        const delta = event.delta ?? '';
        yield {
          type: 'content_block_delta',
          index: Math.max(0, state.blockIndex - 1),
          delta: { type: 'thinking_delta', thinking: delta } as ProviderDelta,
        };
        break;
      }

      // -- Reasoning summary text delta ----------------------------------------
      case 'response.reasoning_summary_text.delta': {
        const delta = event.delta ?? '';
        yield {
          type: 'content_block_delta',
          index: Math.max(0, state.blockIndex - 1),
          delta: { type: 'thinking_delta', thinking: delta } as ProviderDelta,
        };
        break;
      }

      // -- Function call arguments delta --------------------------------------
      case 'response.function_call_arguments.delta': {
        const itemId = event.item_id ?? '';
        const delta = event.delta ?? '';
        const tc = state.toolCalls[itemId];
        if (tc) {
          tc.arguments += delta;
          yield {
            type: 'content_block_delta',
            index: tc.blockIndex,
            delta: { type: 'input_json_delta', partial_json: delta } as ProviderDelta,
          };
        }
        break;
      }

      // -- Function call arguments done ----------------------------------------
      case 'response.function_call_arguments.done': {
        const itemId = event.item_id ?? '';
        const tc = state.toolCalls[itemId];
        if (tc && event.arguments != null) {
          tc.arguments = event.arguments;
        }
        break;
      }

      // -- Output item done ---------------------------------------------------
      case 'response.output_item.done': {
        const item = event.item;
        if (!item) break;

        if (item.type === 'function_call') {
          const tc = state.toolCalls[item.id ?? ''];
          if (tc) {
            yield { type: 'content_block_stop', index: tc.blockIndex };
            delete state.toolCalls[item.id ?? ''];
          }
        } else if (item.type === 'message' || item.type === 'reasoning') {
          const stopIdx = Math.max(0, state.blockIndex - 1);
          yield { type: 'content_block_stop', index: stopIdx };
        }
        break;
      }

      // -- Response completed / incomplete ------------------------------------
      case 'response.completed':
      case 'response.incomplete': {
        const resp = event.response;
        const usage = this.mapUsage(resp?.usage);
        const stopReason = this.mapStopReason(resp, state.hasToolCalls);
        yield { type: 'message_delta', stopReason, usage };
        yield { type: 'message_stop' };
        state.responseCompleted = true;
        break;
      }

      // -- Response failed ----------------------------------------------------
      case 'response.failed': {
        const resp = event.response;
        const errorMsg = resp?.error?.message ?? 'Response failed';
        yield {
          type: 'error',
          error: new ProviderError(errorMsg, undefined, this.providerId),
        };
        yield { type: 'message_delta', stopReason: 'end_turn' };
        yield { type: 'message_stop' };
        state.responseCompleted = true;
        break;
      }

      // -- Error event --------------------------------------------------------
      case 'error': {
        yield {
          type: 'error',
          error: new ProviderError(
            event.error?.message ?? 'Unknown error',
            undefined,
            this.providerId
          ),
        };
        break;
      }

      // Ignore unrecognized events
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Mapping helpers
  // -------------------------------------------------------------------------

  /** Map Open Responses usage to `ProviderUsage`. */
  private mapUsage(usage?: ResponseUsage): ProviderUsage {
    return {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadInputTokens: usage?.input_tokens_details?.cached_tokens,
    };
  }

  /** Derive a stop reason from the response body. */
  private mapStopReason(
    resp: OpenResponsesResponseBody | undefined,
    hasToolCalls: boolean
  ): string {
    if (hasToolCalls) return 'tool_use';

    const reason = resp?.incomplete_details?.reason;
    if (reason === 'max_output_tokens') return 'max_tokens';
    if (reason) return reason;

    if (resp?.status === 'completed') return 'end_turn';
    if (resp?.status === 'incomplete') return 'max_tokens';
    if (resp?.status === 'failed') return 'end_turn';

    return 'end_turn';
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create an Open Responses provider instance.
 *
 * @example
 * ```ts
 * const provider = createOpenResponses({
 *   name: 'my-server',
 *   url: 'http://localhost:1234/v1/responses',
 * });
 * ```
 */
export function createOpenResponses(config: OpenResponsesProviderConfig): OpenResponsesProvider {
  return new OpenResponsesProvider(config);
}

/**
 * Convenience alias for `createOpenResponses`.
 */
export function openResponses(config: OpenResponsesProviderConfig): OpenResponsesProvider {
  return createOpenResponses(config);
}
