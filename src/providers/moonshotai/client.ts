/**
 * Moonshot AI provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getMoonshotAIModelInfo } from './models.js';

export type MoonshotAIProviderConfig = OpenAICompatibleConfig;

export class MoonshotAIProvider extends OpenAICompatibleProvider {
  readonly providerId = 'moonshotai';

  protected getDefaultApiKeyEnvVar(): string {
    return 'MOONSHOT_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.moonshot.cn/v1';
  }

  protected getProviderName(): string {
    return 'Moonshot AI';
  }

  getModelInfo(modelId: string): ModelInfo {
    return getMoonshotAIModelInfo(modelId);
  }
}

export function createMoonshotAIProvider(config?: MoonshotAIProviderConfig): MoonshotAIProvider {
  return new MoonshotAIProvider(config);
}

export function moonshotai(config?: MoonshotAIProviderConfig): MoonshotAIProvider {
  return createMoonshotAIProvider(config);
}
