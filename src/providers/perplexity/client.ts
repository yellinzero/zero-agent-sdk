/**
 * Perplexity provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getPerplexityModelInfo } from './models.js';

export type PerplexityProviderConfig = OpenAICompatibleConfig;

export class PerplexityProvider extends OpenAICompatibleProvider {
  readonly providerId = 'perplexity';

  protected getDefaultApiKeyEnvVar(): string {
    return 'PERPLEXITY_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.perplexity.ai';
  }

  protected getProviderName(): string {
    return 'Perplexity';
  }

  getModelInfo(modelId: string): ModelInfo {
    return getPerplexityModelInfo(modelId);
  }
}

export function createPerplexityProvider(config?: PerplexityProviderConfig): PerplexityProvider {
  return new PerplexityProvider(config);
}

export function perplexity(config?: PerplexityProviderConfig): PerplexityProvider {
  return createPerplexityProvider(config);
}
