/**
 * DeepSeek provider implementation.
 * Extends OpenAICompatibleProvider with DeepSeek-specific features.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo, StreamMessageParams } from '../types.js';
import { getDeepSeekModelInfo } from './models.js';

export type DeepSeekProviderConfig = OpenAICompatibleConfig;

export class DeepSeekProvider extends OpenAICompatibleProvider {
  readonly providerId = 'deepseek';

  protected getDefaultApiKeyEnvVar(): string {
    return 'DEEPSEEK_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.deepseek.com/v1';
  }

  protected getProviderName(): string {
    return 'DeepSeek';
  }

  getModelInfo(modelId: string): ModelInfo {
    return getDeepSeekModelInfo(modelId);
  }

  protected override customizeRequest(
    request: Record<string, unknown>,
    params: StreamMessageParams
  ): Record<string, unknown> {
    // deepseek-reasoner uses reasoning_content field for chain-of-thought
    const modelInfo = this.getModelInfo(params.model);
    if (params.thinkingConfig?.type === 'enabled' && modelInfo.supportsThinking) {
      request.reasoning_effort = 'high';
    }
    return request;
  }
}

export function createDeepSeekProvider(config?: DeepSeekProviderConfig): DeepSeekProvider {
  return new DeepSeekProvider(config);
}

export function deepseek(config?: DeepSeekProviderConfig): DeepSeekProvider {
  return createDeepSeekProvider(config);
}
