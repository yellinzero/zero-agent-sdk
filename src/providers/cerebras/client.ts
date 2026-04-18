/**
 * Cerebras provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getCerebrasModelInfo } from './models.js';

export type CerebrasProviderConfig = OpenAICompatibleConfig;

export class CerebrasProvider extends OpenAICompatibleProvider {
  readonly providerId = 'cerebras';

  protected getDefaultApiKeyEnvVar(): string {
    return 'CEREBRAS_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.cerebras.ai/v1';
  }

  protected getProviderName(): string {
    return 'Cerebras';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getCerebrasModelInfo(modelId));
  }
}

export function createCerebrasProvider(config?: CerebrasProviderConfig): CerebrasProvider {
  return new CerebrasProvider(config);
}

export function cerebras(config?: CerebrasProviderConfig): CerebrasProvider {
  return createCerebrasProvider(config);
}
