/**
 * Together AI provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getTogetherAIModelInfo } from './models.js';

export type TogetherAIProviderConfig = OpenAICompatibleConfig;

export class TogetherAIProvider extends OpenAICompatibleProvider {
  readonly providerId = 'togetherai';

  protected getDefaultApiKeyEnvVar(): string {
    return 'TOGETHER_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.together.xyz/v1';
  }

  protected getProviderName(): string {
    return 'Together AI';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getTogetherAIModelInfo(modelId));
  }
}

export function createTogetherAIProvider(config?: TogetherAIProviderConfig): TogetherAIProvider {
  return new TogetherAIProvider(config);
}

export function togetherai(config?: TogetherAIProviderConfig): TogetherAIProvider {
  return createTogetherAIProvider(config);
}
