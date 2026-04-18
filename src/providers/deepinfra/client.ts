/**
 * DeepInfra provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getDeepInfraModelInfo } from './models.js';

export type DeepInfraProviderConfig = OpenAICompatibleConfig;

export class DeepInfraProvider extends OpenAICompatibleProvider {
  readonly providerId = 'deepinfra';

  protected getDefaultApiKeyEnvVar(): string {
    return 'DEEPINFRA_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.deepinfra.com/v1/openai';
  }

  protected getProviderName(): string {
    return 'DeepInfra';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getDeepInfraModelInfo(modelId));
  }
}

export function createDeepInfraProvider(config?: DeepInfraProviderConfig): DeepInfraProvider {
  return new DeepInfraProvider(config);
}

export function deepinfra(config?: DeepInfraProviderConfig): DeepInfraProvider {
  return createDeepInfraProvider(config);
}
