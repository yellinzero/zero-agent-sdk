/**
 * OpenAI provider implementation.
 * Extends OpenAICompatibleProvider with OpenAI-specific features:
 * - reasoning_effort mapping for o-series models
 * - Organization support
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo, StreamMessageParams } from '../types.js';
import { getOpenAIModelInfo } from './models.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OpenAIProviderConfig extends OpenAICompatibleConfig {
  /** Organization ID. */
  organization?: string;
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly providerId = 'openai';
  private organization?: string;

  constructor(config: OpenAIProviderConfig = {}) {
    super(config);
    this.organization = config.organization;
  }

  protected getDefaultApiKeyEnvVar(): string {
    return 'OPENAI_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.openai.com/v1';
  }

  protected getProviderName(): string {
    return 'OpenAI';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getOpenAIModelInfo(modelId));
  }

  protected override async getClient(): Promise<any> {
    if (!(this as any)._client) {
      try {
        const { default: OpenAI } = await import('openai');
        (this as any)._client = new OpenAI({
          apiKey: this.resolveApiKey(),
          baseURL: this.config.baseUrl ?? this.getDefaultBaseUrl(),
          organization: this.organization,
          maxRetries: this.config.maxRetries ?? 2,
          defaultHeaders: this.config.defaultHeaders,
        });
      } catch {
        throw new Error('Failed to import openai. Install it with: npm install openai');
      }
    }
    return (this as any)._client;
  }

  protected override customizeRequest(
    request: Record<string, unknown>,
    params: StreamMessageParams
  ): Record<string, unknown> {
    const modelInfo = this.getModelInfo(params.model);

    // Reasoning effort for o-series models
    if (params.thinkingConfig?.type === 'enabled' && modelInfo.supportsThinking) {
      request.reasoning_effort = this.mapReasoningEffort(params.thinkingConfig.budgetTokens);
    }

    return request;
  }

  private mapReasoningEffort(budgetTokens?: number): string {
    if (!budgetTokens) return 'medium';
    if (budgetTokens >= 20000) return 'high';
    if (budgetTokens >= 5000) return 'medium';
    return 'low';
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

export function createOpenAIProvider(config?: OpenAIProviderConfig): OpenAIProvider {
  return new OpenAIProvider(config);
}

export function openai(config?: OpenAIProviderConfig): OpenAIProvider {
  return createOpenAIProvider(config);
}
