/**
 * Baseten provider implementation.
 * Baseten uses custom model-based URLs; the baseUrl should point to the deployed model endpoint.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getBasetenModelInfo } from './models.js';

export type BasetenProviderConfig = OpenAICompatibleConfig;

export class BasetenProvider extends OpenAICompatibleProvider {
  readonly providerId = 'baseten';

  protected getDefaultApiKeyEnvVar(): string {
    return 'BASETEN_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://bridge.baseten.co/v1/direct';
  }

  protected getProviderName(): string {
    return 'Baseten';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getBasetenModelInfo(modelId));
  }
}

export function createBasetenProvider(config?: BasetenProviderConfig): BasetenProvider {
  return new BasetenProvider(config);
}

export function baseten(config?: BasetenProviderConfig): BasetenProvider {
  return createBasetenProvider(config);
}
