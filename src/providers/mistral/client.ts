/**
 * Mistral provider implementation.
 * OpenAI-compatible API.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getMistralModelInfo } from './models.js';

export type MistralProviderConfig = OpenAICompatibleConfig;

export class MistralProvider extends OpenAICompatibleProvider {
  readonly providerId = 'mistral';

  protected getDefaultApiKeyEnvVar(): string {
    return 'MISTRAL_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.mistral.ai/v1';
  }

  protected getProviderName(): string {
    return 'Mistral';
  }

  getModelInfo(modelId: string): ModelInfo {
    return getMistralModelInfo(modelId);
  }
}

export function createMistralProvider(config?: MistralProviderConfig): MistralProvider {
  return new MistralProvider(config);
}

export function mistral(config?: MistralProviderConfig): MistralProvider {
  return createMistralProvider(config);
}
