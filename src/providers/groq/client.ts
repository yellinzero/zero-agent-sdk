/**
 * Groq provider implementation.
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getGroqModelInfo } from './models.js';

export type GroqProviderConfig = OpenAICompatibleConfig;

export class GroqProvider extends OpenAICompatibleProvider {
  readonly providerId = 'groq';

  protected getDefaultApiKeyEnvVar(): string {
    return 'GROQ_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.groq.com/openai/v1';
  }

  protected getProviderName(): string {
    return 'Groq';
  }

  getModelInfo(modelId: string): ModelInfo {
    return getGroqModelInfo(modelId);
  }
}

export function createGroqProvider(config?: GroqProviderConfig): GroqProvider {
  return new GroqProvider(config);
}

export function groq(config?: GroqProviderConfig): GroqProvider {
  return createGroqProvider(config);
}
