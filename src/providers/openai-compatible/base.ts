/**
 * OpenAI-Compatible base provider.
 * Abstract class that implements ModelProvider for any OpenAI-compatible API.
 * Most providers (DeepSeek, Mistral, Groq, etc.) inherit from this class
 * and only need to configure baseUrl, apiKey, and model catalog.
 */

import type {
  GenerateMessageParams,
  ModelInfo,
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderToolSchema,
  ProviderUsage,
  StreamMessageParams,
  SystemPromptBlock,
} from '../types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OpenAICompatibleConfig {
  /** API key. If not set, reads from the env var returned by getDefaultApiKeyEnvVar(). */
  apiKey?: string;

  /** Base URL for the API. Overrides the provider's default. */
  baseUrl?: string;

  /** Maximum retries on transient errors. */
  maxRetries?: number;

  /** Default headers to include in requests. */
  defaultHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Internal OpenAI-compatible types (minimal, to avoid hard dependency)
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Abstract Base Provider
// ---------------------------------------------------------------------------

export abstract class OpenAICompatibleProvider implements ModelProvider {
  abstract readonly providerId: string;
  protected config: OpenAICompatibleConfig;
  private _client: any;

  constructor(config: OpenAICompatibleConfig = {}) {
    this.config = config;
  }

  /** Env var name for the API key (e.g. 'OPENAI_API_KEY'). */
  protected abstract getDefaultApiKeyEnvVar(): string;

  /** Default base URL for this provider's API. */
  protected abstract getDefaultBaseUrl(): string;

  /** Provider display name for error messages. */
  protected abstract getProviderName(): string;

  /** Get model info for a known model, or return a default. */
  abstract getModelInfo(modelId: string): ModelInfo;

  /**
   * Optional hook to customize the request before sending.
   * Subclasses can override to add provider-specific parameters.
   */
  protected customizeRequest(
    request: Record<string, unknown>,
    _params: StreamMessageParams
  ): Record<string, unknown> {
    return request;
  }

  /**
   * Whether this provider requires the `openai` npm package.
   * Override to false for providers using raw fetch.
   */
  protected requiresOpenAIPackage(): boolean {
    return true;
  }

  /**
   * Get the SDK install instruction for error messages.
   */
  protected getInstallInstruction(): string {
    return 'npm install openai';
  }

  // ---------------------------------------------------------------------------
  // Client management
  // ---------------------------------------------------------------------------

  protected async getClient(): Promise<any> {
    if (!this._client) {
      try {
        const { default: OpenAI } = await import('openai');
        this._client = new OpenAI({
          apiKey: this.resolveApiKey(),
          baseURL: this.config.baseUrl ?? this.getDefaultBaseUrl(),
          maxRetries: this.config.maxRetries ?? 2,
          defaultHeaders: this.config.defaultHeaders,
        });
      } catch {
        throw new Error(
          `Failed to import openai. Install it with: ${this.getInstallInstruction()}`
        );
      }
    }
    return this._client;
  }

  protected resolveApiKey(): string | undefined {
    return this.config.apiKey ?? process.env[this.getDefaultApiKeyEnvVar()];
  }

  // ---------------------------------------------------------------------------
  // ModelProvider interface
  // ---------------------------------------------------------------------------

  async *streamMessage(params: StreamMessageParams): AsyncGenerator<ProviderStreamEvent> {
    const client = await this.getClient();
    const requestParams = this.buildRequestParams(params, true);

    try {
      const stream = await client.chat.completions.create(requestParams, {
        signal: params.signal,
      });

      yield {
        type: 'message_start',
        model: params.model,
      };

      let currentContentIndex = 0;
      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
      let textStarted = false;

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) {
          if (chunk.usage) {
            yield {
              type: 'message_delta',
              usage: this.mapUsage(chunk.usage),
            };
          }
          continue;
        }

        const delta = choice.delta;

        // Text content
        if (delta?.content) {
          if (!textStarted) {
            yield {
              type: 'content_block_start',
              index: currentContentIndex,
              block: { type: 'text', text: '' },
            };
            textStarted = true;
          }
          yield {
            type: 'content_block_delta',
            index: currentContentIndex,
            delta: { type: 'text_delta', text: delta.content },
          };
        }

        // Tool calls
        if (delta?.tool_calls) {
          if (textStarted) {
            yield { type: 'content_block_stop', index: currentContentIndex };
            currentContentIndex++;
            textStarted = false;
          }

          for (const tc of delta.tool_calls) {
            const tcIndex = tc.index ?? 0;

            if (tc.id) {
              toolCallBuffers.set(tcIndex, {
                id: tc.id,
                name: tc.function?.name ?? '',
                args: tc.function?.arguments ?? '',
              });
              yield {
                type: 'content_block_start',
                index: currentContentIndex + tcIndex,
                block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function?.name ?? '',
                  input: {},
                },
              };
            } else {
              const buf = toolCallBuffers.get(tcIndex);
              if (buf) {
                if (tc.function?.name && !buf.name) buf.name = tc.function.name;
                if (tc.function?.arguments) buf.args += tc.function.arguments;
              }
            }

            if (tc.function?.arguments) {
              yield {
                type: 'content_block_delta',
                index: currentContentIndex + tcIndex,
                delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
              };
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          if (textStarted) {
            yield { type: 'content_block_stop', index: currentContentIndex };
            currentContentIndex++;
            textStarted = false;
          }

          for (const [tcIndex] of toolCallBuffers) {
            yield { type: 'content_block_stop', index: currentContentIndex + tcIndex };
          }

          const usage = chunk.usage
            ? this.mapUsage(chunk.usage)
            : { inputTokens: 0, outputTokens: 0 };

          yield {
            type: 'message_delta',
            stopReason: this.mapFinishReason(choice.finish_reason),
            usage,
          };
        }
      }

      yield { type: 'message_stop' };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async generateMessage(params: GenerateMessageParams): Promise<ProviderResponse> {
    const client = await this.getClient();
    const requestParams = this.buildRequestParams(params, false);

    const response = await client.chat.completions.create(requestParams, {
      signal: params.signal,
    });

    const choice = response.choices?.[0];
    const content = this.mapResponseContent(choice);

    return {
      id: response.id ?? '',
      model: response.model ?? params.model,
      content,
      stopReason: this.mapFinishReason(choice?.finish_reason ?? 'stop'),
      usage: this.mapUsage(response.usage),
    };
  }

  // ---------------------------------------------------------------------------
  // Request Building
  // ---------------------------------------------------------------------------

  protected buildRequestParams(
    params: StreamMessageParams,
    stream: boolean
  ): Record<string, unknown> {
    const messages = this.buildMessages(params.messages, params.systemPrompt);

    const request: Record<string, unknown> = {
      model: params.model,
      messages,
      stream,
    };

    if (stream) {
      request.stream_options = { include_usage: true };
    }

    const modelInfo = this.getModelInfo(params.model);
    if (params.maxOutputTokens) {
      request.max_tokens = params.maxOutputTokens;
    } else if (!modelInfo.supportsThinking) {
      request.max_tokens = modelInfo.maxOutputTokens;
    }

    if (params.tools && params.tools.length > 0) {
      request.tools = params.tools.map((t) => this.mapToolSchema(t));
    }

    if (params.temperature !== undefined && !modelInfo.supportsThinking) {
      request.temperature = params.temperature;
    }

    if (params.topP !== undefined && !modelInfo.supportsThinking) {
      request.top_p = params.topP;
    }

    if (params.stopSequences && params.stopSequences.length > 0) {
      request.stop = params.stopSequences;
    }

    return this.customizeRequest(request, params);
  }

  // ---------------------------------------------------------------------------
  // Message Mapping: SDK -> OpenAI
  // ---------------------------------------------------------------------------

  protected buildMessages(
    messages: ProviderMessage[],
    systemPrompt: string | SystemPromptBlock[]
  ): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    if (systemPrompt) {
      const text =
        typeof systemPrompt === 'string'
          ? systemPrompt
          : systemPrompt.map((b) => b.text).join('\n\n');
      if (text) {
        result.push({ role: 'system', content: text });
      }
    }

    for (const msg of messages) {
      const textParts: ProviderContentBlock[] = [];
      const toolUseParts: ProviderContentBlock[] = [];
      const toolResultParts: ProviderContentBlock[] = [];

      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          toolResultParts.push(block);
        } else if (block.type === 'tool_use') {
          toolUseParts.push(block);
        } else {
          textParts.push(block);
        }
      }

      if (msg.role === 'assistant') {
        const oaiMsg: OpenAIMessage = { role: 'assistant' };

        if (textParts.length > 0) {
          const mapped = this.mapContentPartsToOpenAI(textParts);
          if (mapped.length === 1 && mapped[0].type === 'text') {
            oaiMsg.content = mapped[0].text!;
          } else if (mapped.length > 0) {
            oaiMsg.content = mapped;
          }
        }

        if (toolUseParts.length > 0) {
          oaiMsg.tool_calls = toolUseParts.map((block) => {
            if (block.type !== 'tool_use') throw new Error('Expected tool_use block');
            return {
              id: block.id,
              type: 'function' as const,
              function: {
                name: block.name,
                arguments:
                  typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
              },
            };
          });
        }

        if (oaiMsg.content !== undefined || oaiMsg.tool_calls) {
          result.push(oaiMsg);
        }
      } else {
        for (const block of toolResultParts) {
          if (block.type !== 'tool_result') continue;
          const content =
            typeof block.content === 'string'
              ? block.content
              : block.content
                  .map((b) => {
                    if (b.type === 'text') return b.text;
                    return JSON.stringify(b);
                  })
                  .join('\n');
          result.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content,
          });
        }

        if (textParts.length > 0) {
          const mapped = this.mapContentPartsToOpenAI(textParts);
          if (mapped.length === 1 && mapped[0].type === 'text') {
            result.push({ role: 'user', content: mapped[0].text! });
          } else if (mapped.length > 0) {
            result.push({ role: 'user', content: mapped });
          }
        }
      }
    }

    return result;
  }

  protected mapContentPartsToOpenAI(blocks: ProviderContentBlock[]): OpenAIContentPart[] {
    const parts: OpenAIContentPart[] = [];
    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          parts.push({ type: 'text', text: block.text });
          break;
        case 'image':
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
              detail: 'auto',
            },
          });
          break;
        case 'thinking':
        case 'redacted_thinking':
          break;
        case 'document':
          parts.push({
            type: 'text',
            text: '[Document content omitted — not supported by this provider]',
          });
          break;
      }
    }
    return parts;
  }

  protected mapToolSchema(tool: ProviderToolSchema): OpenAITool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Response Mapping: OpenAI -> SDK
  // ---------------------------------------------------------------------------

  protected mapResponseContent(choice: any): ProviderContentBlock[] {
    if (!choice) return [];

    const content: ProviderContentBlock[] = [];
    const msg = choice.message;

    if (msg?.content) {
      content.push({ type: 'text', text: msg.content });
    }

    if (msg?.tool_calls) {
      for (const tc of msg.tool_calls) {
        let input: unknown;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = tc.function.arguments;
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    return content;
  }

  // ---------------------------------------------------------------------------
  // Usage Mapping
  // ---------------------------------------------------------------------------

  protected mapUsage(usage: any): ProviderUsage {
    if (!usage) return { inputTokens: 0, outputTokens: 0 };
    return {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  protected mapFinishReason(reason: string): string {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'content_filter';
      default:
        return reason;
    }
  }
}
