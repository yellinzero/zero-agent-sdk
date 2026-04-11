/**
 * Alibaba (Qwen) provider implementation.
 * Uses DashScope OpenAI-compatible API.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo, StreamMessageParams } from '../types.js';
import { getAlibabaModelInfo } from './models.js';

export type AlibabaProviderConfig = OpenAICompatibleConfig;

export class AlibabaProvider extends OpenAICompatibleProvider {
  readonly providerId = 'alibaba';

  protected getDefaultApiKeyEnvVar(): string {
    return 'DASHSCOPE_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }

  protected getProviderName(): string {
    return 'Alibaba (Qwen)';
  }

  getModelInfo(modelId: string): ModelInfo {
    return getAlibabaModelInfo(modelId);
  }

  protected override customizeRequest(
    request: Record<string, unknown>,
    params: StreamMessageParams
  ): Record<string, unknown> {
    // qwq models support reasoning_content similar to DeepSeek
    const modelInfo = this.getModelInfo(params.model);
    if (params.thinkingConfig?.type === 'enabled' && modelInfo.supportsThinking) {
      request.reasoning_effort = 'high';
    }
    return request;
  }
}

export function createAlibabaProvider(config?: AlibabaProviderConfig): AlibabaProvider {
  return new AlibabaProvider(config);
}

export function alibaba(config?: AlibabaProviderConfig): AlibabaProvider {
  return createAlibabaProvider(config);
}
