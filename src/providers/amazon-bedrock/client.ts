/**
 * Amazon Bedrock provider implementation.
 * Uses the Bedrock Converse API via @aws-sdk/client-bedrock-runtime.
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
  ToolChoice,
} from '../types.js';
import { getBedrockModelInfo } from './models.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BedrockProviderConfig {
  /** AWS region. Defaults to AWS_REGION env var or 'us-east-1'. */
  region?: string;

  /** AWS access key ID. Defaults to AWS_ACCESS_KEY_ID env var. */
  accessKeyId?: string;

  /** AWS secret access key. Defaults to AWS_SECRET_ACCESS_KEY env var. */
  secretAccessKey?: string;

  /** AWS session token. Defaults to AWS_SESSION_TOKEN env var. */
  sessionToken?: string;
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class BedrockProvider implements ModelProvider {
  readonly providerId = 'amazon-bedrock';
  private config: BedrockProviderConfig;
  private _client: any;

  constructor(config: BedrockProviderConfig = {}) {
    this.config = config;
  }

  private async getClient() {
    if (!this._client) {
      try {
        const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');

        const clientConfig: Record<string, unknown> = {
          region: this.config.region ?? process.env.AWS_REGION ?? 'us-east-1',
        };

        if (this.config.accessKeyId || process.env.AWS_ACCESS_KEY_ID) {
          clientConfig.credentials = {
            accessKeyId: this.config.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: this.config.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: this.config.sessionToken ?? process.env.AWS_SESSION_TOKEN,
          };
        }

        this._client = new BedrockRuntimeClient(clientConfig);
      } catch {
        throw new Error(
          'Failed to import @aws-sdk/client-bedrock-runtime. Install it with: npm install @aws-sdk/client-bedrock-runtime'
        );
      }
    }
    return this._client;
  }

  getModelInfo(modelId: string): ModelInfo {
    const info = getBedrockModelInfo(modelId);
    return {
      ...info,
      supportsToolChoice: info.supportsToolChoice ?? true,
      supportsResponseFormat: info.supportsResponseFormat ?? ['text'],
      responseFormatStrategy: info.responseFormatStrategy ?? 'tool-synthesis',
    };
  }

  async *streamMessage(params: StreamMessageParams): AsyncGenerator<ProviderStreamEvent> {
    const client = await this.getClient();

    try {
      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');

      const request = this.buildConverseRequest(params);
      const command = new ConverseStreamCommand(request as any);
      const response = await client.send(command, {
        abortSignal: params.signal,
      });

      yield { type: 'message_start', model: params.model };

      let contentIndex = 0;
      let textStarted = false;

      if (response.stream) {
        for await (const event of response.stream) {
          if (event.contentBlockStart) {
            const start = event.contentBlockStart;
            if (start.start?.toolUse) {
              if (textStarted) {
                yield { type: 'content_block_stop', index: contentIndex };
                contentIndex++;
                textStarted = false;
              }
              yield {
                type: 'content_block_start',
                index: start.contentBlockIndex ?? contentIndex,
                block: {
                  type: 'tool_use',
                  id: start.start.toolUse.toolUseId ?? `call_${contentIndex}`,
                  name: start.start.toolUse.name ?? '',
                  input: {},
                },
              };
            }
          }

          if (event.contentBlockDelta) {
            const delta = event.contentBlockDelta;
            if (delta.delta?.text) {
              if (!textStarted) {
                yield {
                  type: 'content_block_start',
                  index: contentIndex,
                  block: { type: 'text', text: '' },
                };
                textStarted = true;
              }
              yield {
                type: 'content_block_delta',
                index: delta.contentBlockIndex ?? contentIndex,
                delta: { type: 'text_delta', text: delta.delta.text },
              };
            }
            if (delta.delta?.toolUse) {
              yield {
                type: 'content_block_delta',
                index: delta.contentBlockIndex ?? contentIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: delta.delta.toolUse.input ?? '',
                },
              };
            }
          }

          if (event.contentBlockStop) {
            yield {
              type: 'content_block_stop',
              index: event.contentBlockStop.contentBlockIndex ?? contentIndex,
            };
            contentIndex++;
            textStarted = false;
          }

          if (event.messageStop) {
            yield {
              type: 'message_delta',
              stopReason: this.mapStopReason(event.messageStop.stopReason ?? 'end_turn'),
            };
          }

          if (event.metadata) {
            const usage = event.metadata.usage;
            if (usage) {
              yield {
                type: 'message_delta',
                usage: {
                  inputTokens: usage.inputTokens ?? 0,
                  outputTokens: usage.outputTokens ?? 0,
                },
              };
            }
          }
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
    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');

    const request = this.buildConverseRequest(params);
    const command = new ConverseCommand(request as any);
    const response = await client.send(command, {
      abortSignal: params.signal,
    });

    const content = this.mapConverseContent(response.output?.message?.content ?? []);

    return {
      id: response.$metadata?.requestId ?? '',
      model: params.model,
      content,
      stopReason: this.mapStopReason(response.stopReason ?? 'end_turn'),
      usage: {
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Request Building (Converse API)
  // ---------------------------------------------------------------------------

  private buildConverseRequest(params: StreamMessageParams): Record<string, unknown> {
    const messages = this.convertMessages(params.messages);

    const request: Record<string, unknown> = {
      modelId: params.model,
      messages,
    };

    // System prompt
    if (params.systemPrompt) {
      const text =
        typeof params.systemPrompt === 'string'
          ? params.systemPrompt
          : params.systemPrompt.map((b) => b.text).join('\n\n');
      if (text) {
        request.system = [{ text }];
      }
    }

    // Tools + toolChoice.
    if (params.tools && params.tools.length > 0) {
      const toolConfig: Record<string, unknown> = {
        tools: params.tools.map((t) => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.inputSchema },
          },
        })),
      };
      const tc = this.mapToolChoice(params.toolChoice);
      if (tc !== undefined) toolConfig.toolChoice = tc;
      request.toolConfig = toolConfig;
    }

    // Inference config
    const inferenceConfig: Record<string, unknown> = {};
    const modelInfo = this.getModelInfo(params.model);

    if (params.maxOutputTokens) {
      inferenceConfig.maxTokens = params.maxOutputTokens;
    } else {
      inferenceConfig.maxTokens = modelInfo.maxOutputTokens;
    }

    if (params.temperature !== undefined) {
      inferenceConfig.temperature = params.temperature;
    }

    if (params.topP !== undefined) {
      inferenceConfig.topP = params.topP;
    }

    if (params.stopSequences && params.stopSequences.length > 0) {
      inferenceConfig.stopSequences = params.stopSequences;
    }

    request.inferenceConfig = inferenceConfig;

    return request;
  }

  private mapToolChoice(choice: ToolChoice | undefined): Record<string, unknown> | undefined {
    if (!choice) return undefined;
    switch (choice.type) {
      case 'auto':
        return { auto: {} };
      case 'any':
        return { any: {} };
      case 'tool':
        return { tool: { name: choice.name } };
      case 'none':
        // Converse has no 'none'; caller should drop tools entirely. Skip here.
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Message Conversion
  // ---------------------------------------------------------------------------

  private convertMessages(messages: ProviderMessage[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];

    for (const msg of messages) {
      const content: Record<string, unknown>[] = [];

      for (const block of msg.content) {
        switch (block.type) {
          case 'text':
            content.push({ text: block.text });
            break;
          case 'image':
            content.push({
              image: {
                format: block.source.media_type.split('/')[1] ?? 'png',
                source: { bytes: Buffer.from(block.source.data, 'base64') },
              },
            });
            break;
          case 'tool_use':
            content.push({
              toolUse: {
                toolUseId: block.id,
                name: block.name,
                input: block.input,
              },
            });
            break;
          case 'tool_result': {
            const resultContent =
              typeof block.content === 'string'
                ? [{ text: block.content }]
                : block.content.map((b) =>
                    b.type === 'text' ? { text: b.text } : { text: JSON.stringify(b) }
                  );
            content.push({
              toolResult: {
                toolUseId: block.tool_use_id,
                content: resultContent,
                status: block.is_error ? 'error' : 'success',
              },
            });
            break;
          }
          // Skip thinking blocks
        }
      }

      if (content.length > 0) {
        result.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content,
        });
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Response Mapping
  // ---------------------------------------------------------------------------

  private mapConverseContent(content: any[]): ProviderContentBlock[] {
    const result: ProviderContentBlock[] = [];

    for (const block of content) {
      if (block.text) {
        result.push({ type: 'text', text: block.text });
      }
      if (block.toolUse) {
        result.push({
          type: 'tool_use',
          id: block.toolUse.toolUseId ?? '',
          name: block.toolUse.name ?? '',
          input: block.toolUse.input ?? {},
        });
      }
    }

    return result;
  }

  private mapStopReason(reason: string): string {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      case 'content_filtered':
        return 'content_filter';
      default:
        return reason;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

export function createBedrockProvider(config?: BedrockProviderConfig): BedrockProvider {
  return new BedrockProvider(config);
}

export function bedrock(config?: BedrockProviderConfig): BedrockProvider {
  return createBedrockProvider(config);
}
