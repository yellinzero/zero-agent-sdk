/**
 * Cohere provider implementation.
 * Cohere v2 API is OpenAI-compatible.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getCohereModelInfo } from './models.js';

export type CohereProviderConfig = OpenAICompatibleConfig;

export class CohereProvider extends OpenAICompatibleProvider {
  readonly providerId = 'cohere';

  protected getDefaultApiKeyEnvVar(): string {
    return 'COHERE_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.cohere.com/v2';
  }

  protected getProviderName(): string {
    return 'Cohere';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getCohereModelInfo(modelId));
  }
}

export function createCohereProvider(config?: CohereProviderConfig): CohereProvider {
  return new CohereProvider(config);
}

export function cohere(config?: CohereProviderConfig): CohereProvider {
  return createCohereProvider(config);
}
