/**
 * Fireworks AI provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getFireworksModelInfo } from './models.js';

export type FireworksProviderConfig = OpenAICompatibleConfig;

export class FireworksProvider extends OpenAICompatibleProvider {
  readonly providerId = 'fireworks';

  protected getDefaultApiKeyEnvVar(): string {
    return 'FIREWORKS_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.fireworks.ai/inference/v1';
  }

  protected getProviderName(): string {
    return 'Fireworks AI';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getFireworksModelInfo(modelId));
  }
}

export function createFireworksProvider(config?: FireworksProviderConfig): FireworksProvider {
  return new FireworksProvider(config);
}

export function fireworks(config?: FireworksProviderConfig): FireworksProvider {
  return createFireworksProvider(config);
}
