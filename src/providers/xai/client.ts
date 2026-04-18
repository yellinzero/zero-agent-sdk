/**
 * xAI (Grok) provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getXAIModelInfo } from './models.js';

export type XAIProviderConfig = OpenAICompatibleConfig;

export class XAIProvider extends OpenAICompatibleProvider {
  readonly providerId = 'xai';

  protected getDefaultApiKeyEnvVar(): string {
    return 'XAI_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.x.ai/v1';
  }

  protected getProviderName(): string {
    return 'xAI';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getXAIModelInfo(modelId));
  }
}

export function createXAIProvider(config?: XAIProviderConfig): XAIProvider {
  return new XAIProvider(config);
}

export function xai(config?: XAIProviderConfig): XAIProvider {
  return createXAIProvider(config);
}
