/**
 * Anthropic provider implementation.
 * Wraps the @anthropic-ai/sdk to implement the ModelProvider interface.
 */

import type {
  GenerateMessageParams,
  ModelInfo,
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderThinkingConfig,
  ProviderToolSchema,
  ProviderUsage,
  StreamMessageParams,
  SystemPromptBlock,
  ToolChoice,
} from '../types.js';
import { getAnthropicModelInfo } from './models.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AnthropicProviderConfig {
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string;

  /** Base URL for the API. */
  baseUrl?: string;

  /** Default headers to include in requests. */
  defaultHeaders?: Record<string, string>;

  /** Maximum retries on transient errors. */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class AnthropicProvider implements ModelProvider {
  readonly providerId = 'anthropic';
  private config: AnthropicProviderConfig;
  private _client: any; // Lazy-initialized Anthropic client

  constructor(config: AnthropicProviderConfig = {}) {
    this.config = config;
  }

  private async getClient() {
    if (!this._client) {
      // Lazy import to make @anthropic-ai/sdk a true peer dependency
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        this._client = new Anthropic({
          apiKey: this.config.apiKey ?? process.env.ANTHROPIC_API_KEY,
          baseURL: this.config.baseUrl,
          defaultHeaders: this.config.defaultHeaders,
          maxRetries: this.config.maxRetries ?? 2,
        });
      } catch {
        throw new Error(
          'Failed to import @anthropic-ai/sdk. Install it with: npm install @anthropic-ai/sdk'
        );
      }
    }
    return this._client;
  }

  async *streamMessage(params: StreamMessageParams): AsyncGenerator<ProviderStreamEvent> {
    const client = await this.getClient();
    const requestParams = this.buildRequestParams(params);

    const stream = client.messages.stream(requestParams, {
      signal: params.signal,
    });

    try {
      // Emit message_start
      yield {
        type: 'message_start',
        model: params.model,
      };

      for await (const event of stream) {
        const mapped = this.mapStreamEvent(event);
        if (mapped) {
          yield mapped;
        }
      }

      // Get final message for usage
      const finalMessage = await stream.finalMessage();
      if (finalMessage) {
        yield {
          type: 'message_delta',
          stopReason: finalMessage.stop_reason ?? 'end_turn',
          usage: this.mapUsage(finalMessage.usage),
        };
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
    const requestParams = this.buildRequestParams(params);

    const response = await client.messages.create(requestParams, {
      signal: params.signal,
    });

    return {
      id: response.id,
      model: response.model,
      content: response.content.map((block: any) => this.mapContentBlock(block)),
      stopReason: response.stop_reason ?? 'end_turn',
      usage: this.mapUsage(response.usage),
    };
  }

  getModelInfo(modelId: string): ModelInfo {
    const info = getAnthropicModelInfo(modelId);
    return {
      ...info,
      supportsToolChoice: info.supportsToolChoice ?? true,
      supportsResponseFormat: info.supportsResponseFormat ?? ['text'],
      responseFormatStrategy: info.responseFormatStrategy ?? 'tool-synthesis',
    };
  }

  // ---------------------------------------------------------------------------
  // Request Building
  // ---------------------------------------------------------------------------

  protected buildRequestParams(params: StreamMessageParams): Record<string, unknown> {
    const request: Record<string, unknown> = {
      model: params.model,
      messages: params.messages.map((m) => this.mapMessageToAnthropic(m)),
      max_tokens: params.maxOutputTokens ?? this.getModelInfo(params.model).maxOutputTokens,
    };

    // System prompt
    if (params.systemPrompt) {
      if (typeof params.systemPrompt === 'string') {
        request.system = params.systemPrompt;
      } else {
        request.system = params.systemPrompt.map((block) => ({
          type: 'text',
          text: block.text,
          ...(block.cacheControl ? { cache_control: block.cacheControl } : {}),
        }));
      }
    }

    // Tools + tool_choice (standard path).
    // Anthropic has no { type: 'none' } tool_choice — the native way to
    // disable tools is to not send the tools array. We honor that semantic.
    const forceNoTools = params.toolChoice?.type === 'none';
    if (params.tools && params.tools.length > 0 && !forceNoTools) {
      request.tools = params.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));

      if (params.toolChoice && params.toolChoice.type !== 'none') {
        request.tool_choice = this.mapToolChoice(params.toolChoice);
      }
    }

    // Thinking
    if (params.thinkingConfig?.type === 'enabled') {
      request.thinking = {
        type: 'enabled',
        budget_tokens: params.thinkingConfig.budgetTokens ?? 10000,
      };
      // When thinking is enabled, remove max_tokens and use thinking budget
      delete request.max_tokens;
    }

    // Temperature
    if (params.temperature !== undefined) {
      request.temperature = params.temperature;
    }

    // Top-p
    if (params.topP !== undefined) {
      request.top_p = params.topP;
    }

    // Stop sequences
    if (params.stopSequences) {
      request.stop_sequences = params.stopSequences;
    }

    return request;
  }

  private mapToolChoice(choice: ToolChoice): Record<string, unknown> | null {
    switch (choice.type) {
      case 'auto':
        return { type: 'auto' };
      case 'any':
        return { type: 'any' };
      case 'tool':
        return { type: 'tool', name: choice.name };
      case 'none':
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Message Mapping: SDK → Anthropic
  // ---------------------------------------------------------------------------

  private mapMessageToAnthropic(message: ProviderMessage): Record<string, unknown> {
    return {
      role: message.role,
      content: message.content.map((block) => this.mapContentBlockToAnthropic(block)),
    };
  }

  private mapContentBlockToAnthropic(block: ProviderContentBlock): Record<string, unknown> {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          ...(block.is_error ? { is_error: true } : {}),
          ...(block.cacheControl ? { cache_control: block.cacheControl } : {}),
        };
      case 'thinking':
        return {
          type: 'thinking',
          thinking: block.thinking,
          ...(block.signature ? { signature: block.signature } : {}),
        };
      case 'redacted_thinking':
        return { type: 'redacted_thinking', data: block.data };
      case 'image':
        return { type: 'image', source: block.source };
      case 'document':
        return { type: 'document', source: block.source };
      default:
        return block as Record<string, unknown>;
    }
  }

  // ---------------------------------------------------------------------------
  // Message Mapping: Anthropic → SDK
  // ---------------------------------------------------------------------------

  private mapContentBlock(block: any): ProviderContentBlock {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'thinking':
        return { type: 'thinking', thinking: block.thinking, signature: block.signature };
      case 'redacted_thinking':
        return { type: 'redacted_thinking', data: block.data };
      default:
        return { type: 'text', text: JSON.stringify(block) };
    }
  }

  // ---------------------------------------------------------------------------
  // Stream Event Mapping
  // ---------------------------------------------------------------------------

  private mapStreamEvent(event: any): ProviderStreamEvent | null {
    switch (event.type) {
      case 'message_start':
        return {
          type: 'message_start',
          messageId: event.message?.id,
          model: event.message?.model,
          usage: event.message?.usage ? this.mapUsage(event.message.usage) : undefined,
        };

      case 'content_block_start':
        return {
          type: 'content_block_start',
          index: event.index,
          block: this.mapContentBlock(event.content_block),
        };

      case 'content_block_delta':
        return {
          type: 'content_block_delta',
          index: event.index,
          delta: this.mapDelta(event.delta),
        };

      case 'content_block_stop':
        return {
          type: 'content_block_stop',
          index: event.index,
        };

      case 'message_delta':
        return {
          type: 'message_delta',
          stopReason: event.delta?.stop_reason,
          usage: event.usage ? this.mapUsage(event.usage) : undefined,
        };

      case 'message_stop':
        return { type: 'message_stop' };

      case 'error':
        return {
          type: 'error',
          error: new Error(event.error?.message ?? 'Unknown error'),
        };

      default:
        return null;
    }
  }

  private mapDelta(delta: any): any {
    switch (delta.type) {
      case 'text_delta':
        return { type: 'text_delta', text: delta.text };
      case 'input_json_delta':
        return { type: 'input_json_delta', partial_json: delta.partial_json };
      case 'thinking_delta':
        return { type: 'thinking_delta', thinking: delta.thinking };
      case 'signature_delta':
        return { type: 'signature_delta', signature: delta.signature };
      default:
        return delta;
    }
  }

  // ---------------------------------------------------------------------------
  // Usage Mapping
  // ---------------------------------------------------------------------------

  private mapUsage(usage: any): ProviderUsage {
    return {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create an Anthropic provider instance.
 */
export function createAnthropicProvider(config?: AnthropicProviderConfig): AnthropicProvider {
  return new AnthropicProvider(config);
}

/**
 * Shorthand for creating an Anthropic provider.
 */
export function anthropic(config?: AnthropicProviderConfig): AnthropicProvider {
  return createAnthropicProvider(config);
}
