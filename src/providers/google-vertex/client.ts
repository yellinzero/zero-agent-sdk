/**
 * Google Vertex AI provider implementation.
 * Reuses Google message converter but uses Vertex AI endpoint with GCP OAuth.
 */

import { convertMessages, convertSystemPrompt, convertTools } from '../google/message-converter.js';
import type {
  GoogleCandidate,
  GoogleGenerateContentRequest,
  GoogleGenerateContentResponse,
  GoogleGenerationConfig,
  GoogleStreamChunk,
  GoogleUsageMetadata,
} from '../google/types.js';
import type {
  GenerateMessageParams,
  ModelInfo,
  ModelProvider,
  ProviderContentBlock,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderUsage,
  StreamMessageParams,
} from '../types.js';
import { getVertexModelInfo } from './models.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface VertexAIProviderConfig {
  /** GCP project ID. Defaults to GOOGLE_CLOUD_PROJECT env var. */
  projectId?: string;

  /** GCP region. Defaults to 'us-central1'. */
  region?: string;

  /** OAuth access token. Defaults to GOOGLE_ACCESS_TOKEN env var. */
  accessToken?: string;

  /** Custom endpoint override. */
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class VertexAIProvider implements ModelProvider {
  readonly providerId = 'google-vertex';
  private config: VertexAIProviderConfig;

  constructor(config: VertexAIProviderConfig = {}) {
    this.config = config;
  }

  private get projectId(): string {
    const id = this.config.projectId ?? process.env.GOOGLE_CLOUD_PROJECT;
    if (!id) {
      throw new Error(
        'Google Cloud project ID not found. Set GOOGLE_CLOUD_PROJECT env var or pass projectId in config.'
      );
    }
    return id;
  }

  private get region(): string {
    return this.config.region ?? 'us-central1';
  }

  private get accessToken(): string {
    const token = this.config.accessToken ?? process.env.GOOGLE_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        'Google access token not found. Set GOOGLE_ACCESS_TOKEN env var or pass accessToken in config.'
      );
    }
    return token;
  }

  private get baseUrl(): string {
    return (
      this.config.baseUrl ??
      `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models`
    );
  }

  getModelInfo(modelId: string): ModelInfo {
    return getVertexModelInfo(modelId);
  }

  async *streamMessage(params: StreamMessageParams): AsyncGenerator<ProviderStreamEvent> {
    const url = `${this.baseUrl}/${params.model}:streamGenerateContent?alt=sse`;
    const body = this.buildRequest(params);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: 'error',
          error: new Error(`Vertex AI error ${response.status}: ${errorText}`),
        };
        return;
      }

      yield { type: 'message_start', model: params.model };

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: 'error', error: new Error('No response body') };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let contentIndex = 0;
      let textStarted = false;
      let lastUsage: GoogleUsageMetadata | undefined;
      let lastFinishReason: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          let chunk: GoogleStreamChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          if (chunk.usageMetadata) {
            lastUsage = chunk.usageMetadata;
          }

          const candidate = chunk.candidates?.[0];
          if (!candidate?.content?.parts) continue;

          if (candidate.finishReason) {
            lastFinishReason = candidate.finishReason;
          }

          for (const part of candidate.content.parts) {
            if ('text' in part) {
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
                index: contentIndex,
                delta: { type: 'text_delta', text: part.text },
              };
            } else if ('functionCall' in part) {
              if (textStarted) {
                yield { type: 'content_block_stop', index: contentIndex };
                contentIndex++;
                textStarted = false;
              }

              const toolCallId = `call_${contentIndex}_${Date.now()}`;
              yield {
                type: 'content_block_start',
                index: contentIndex,
                block: {
                  type: 'tool_use',
                  id: toolCallId,
                  name: part.functionCall.name,
                  input: part.functionCall.args,
                },
              };
              yield {
                type: 'content_block_delta',
                index: contentIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: JSON.stringify(part.functionCall.args),
                },
              };
              yield { type: 'content_block_stop', index: contentIndex };
              contentIndex++;
            }
          }
        }
      }

      if (textStarted) {
        yield { type: 'content_block_stop', index: contentIndex };
      }

      yield {
        type: 'message_delta',
        stopReason: this.mapFinishReason(lastFinishReason ?? 'STOP'),
        usage: this.mapUsage(lastUsage),
      };

      yield { type: 'message_stop' };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async generateMessage(params: GenerateMessageParams): Promise<ProviderResponse> {
    const url = `${this.baseUrl}/${params.model}:generateContent`;
    const body = this.buildRequest(params);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vertex AI error ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as GoogleGenerateContentResponse;
    const candidate = result.candidates?.[0];
    const content = this.mapCandidateContent(candidate);

    return {
      id: '',
      model: params.model,
      content,
      stopReason: this.mapFinishReason(candidate?.finishReason ?? 'STOP'),
      usage: this.mapUsage(result.usageMetadata),
    };
  }

  // ---------------------------------------------------------------------------
  // Request Building
  // ---------------------------------------------------------------------------

  private buildRequest(params: StreamMessageParams): GoogleGenerateContentRequest {
    const contents = convertMessages(params.messages);
    const request: GoogleGenerateContentRequest = { contents };

    const systemInstruction = convertSystemPrompt(params.systemPrompt);
    if (systemInstruction) {
      request.systemInstruction = systemInstruction;
    }

    if (params.tools && params.tools.length > 0) {
      request.tools = convertTools(params.tools);
    }

    const generationConfig: GoogleGenerationConfig = {};
    const modelInfo = this.getModelInfo(params.model);

    if (params.maxOutputTokens) {
      generationConfig.maxOutputTokens = params.maxOutputTokens;
    } else {
      generationConfig.maxOutputTokens = modelInfo.maxOutputTokens;
    }

    if (params.temperature !== undefined) {
      generationConfig.temperature = params.temperature;
    }

    if (params.topP !== undefined) {
      generationConfig.topP = params.topP;
    }

    if (params.stopSequences && params.stopSequences.length > 0) {
      generationConfig.stopSequences = params.stopSequences;
    }

    request.generationConfig = generationConfig;
    return request;
  }

  // ---------------------------------------------------------------------------
  // Response Mapping
  // ---------------------------------------------------------------------------

  private mapCandidateContent(candidate?: GoogleCandidate): ProviderContentBlock[] {
    if (!candidate?.content?.parts) return [];

    const content: ProviderContentBlock[] = [];
    for (const part of candidate.content.parts) {
      if ('text' in part) {
        content.push({ type: 'text', text: part.text });
      } else if ('functionCall' in part) {
        content.push({
          type: 'tool_use',
          id: `call_${Date.now()}`,
          name: part.functionCall.name,
          input: part.functionCall.args,
        });
      }
    }
    return content;
  }

  private mapUsage(usage?: GoogleUsageMetadata): ProviderUsage {
    if (!usage) return { inputTokens: 0, outputTokens: 0 };
    return {
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    };
  }

  private mapFinishReason(reason: string): string {
    switch (reason) {
      case 'STOP':
        return 'end_turn';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default:
        return reason.toLowerCase();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

export function createVertexAIProvider(config?: VertexAIProviderConfig): VertexAIProvider {
  return new VertexAIProvider(config);
}

export function googleVertex(config?: VertexAIProviderConfig): VertexAIProvider {
  return createVertexAIProvider(config);
}
