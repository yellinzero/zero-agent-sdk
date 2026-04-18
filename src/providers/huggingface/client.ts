/**
 * Hugging Face Inference API provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getHuggingFaceModelInfo } from './models.js';

export type HuggingFaceProviderConfig = OpenAICompatibleConfig;

export class HuggingFaceProvider extends OpenAICompatibleProvider {
  readonly providerId = 'huggingface';

  protected getDefaultApiKeyEnvVar(): string {
    return 'HF_TOKEN';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api-inference.huggingface.co/v1';
  }

  protected getProviderName(): string {
    return 'Hugging Face';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getHuggingFaceModelInfo(modelId));
  }
}

export function createHuggingFaceProvider(config?: HuggingFaceProviderConfig): HuggingFaceProvider {
  return new HuggingFaceProvider(config);
}

export function huggingface(config?: HuggingFaceProviderConfig): HuggingFaceProvider {
  return createHuggingFaceProvider(config);
}
