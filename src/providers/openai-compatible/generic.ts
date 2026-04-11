/**
 * Generic OpenAI-compatible provider.
 * Fully configurable via constructor — useful for Ollama, vLLM, LiteLLM, LMStudio, etc.
 */

import type { ModelInfo } from '../types.js';
import type { OpenAICompatibleConfig } from './base.js';
import { OpenAICompatibleProvider } from './base.js';

export interface GenericOpenAICompatibleConfig extends OpenAICompatibleConfig {
  /** Provider ID for registry. */
  providerId: string;

  /** Provider display name for error messages. */
  providerName?: string;

  /** Env var name for API key. */
  apiKeyEnvVar?: string;

  /** Model catalog for getModelInfo(). */
  models?: Record<string, ModelInfo>;

  /** Default model info for unknown models. */
  defaultModelInfo?: ModelInfo;
}

const GENERIC_DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: true,
  supportsPdfInput: false,
};

export class GenericOpenAICompatibleProvider extends OpenAICompatibleProvider {
  readonly providerId: string;
  private _providerName: string;
  private _apiKeyEnvVar: string;
  private _models: Record<string, ModelInfo>;
  private _defaultModelInfo: ModelInfo;

  constructor(config: GenericOpenAICompatibleConfig) {
    super(config);
    this.providerId = config.providerId;
    this._providerName = config.providerName ?? config.providerId;
    this._apiKeyEnvVar = config.apiKeyEnvVar ?? '';
    this._models = config.models ?? {};
    this._defaultModelInfo = config.defaultModelInfo ?? GENERIC_DEFAULT_MODEL_INFO;
  }

  protected getDefaultApiKeyEnvVar(): string {
    return this._apiKeyEnvVar;
  }

  protected getDefaultBaseUrl(): string {
    return this.config.baseUrl ?? 'http://localhost:11434/v1';
  }

  protected getProviderName(): string {
    return this._providerName;
  }

  getModelInfo(modelId: string): ModelInfo {
    return this._models[modelId] ?? this._defaultModelInfo;
  }
}

/**
 * Create a generic OpenAI-compatible provider instance.
 */
export function createOpenAICompatible(
  config: GenericOpenAICompatibleConfig
): GenericOpenAICompatibleProvider {
  return new GenericOpenAICompatibleProvider(config);
}
