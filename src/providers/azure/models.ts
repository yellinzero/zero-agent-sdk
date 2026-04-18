/**
 * Azure OpenAI model catalog.
 * Azure uses deployment-based addressing, so model names are deployment IDs.
 * We provide common model metadata for reference.
 */

import type { ModelInfo } from '../types.js';

export const AZURE_MODELS: Record<string, ModelInfo> = {
  'gpt-4o': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object', 'json_schema'],
    responseFormatStrategy: 'native',
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2.5,
    outputTokenCostPer1M: 10,
  },
  'gpt-4o-mini': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object', 'json_schema'],
    responseFormatStrategy: 'native',
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.15,
    outputTokenCostPer1M: 0.6,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  supportsThinking: false,
  supportsToolUse: true,
  supportsResponseFormat: ['text', 'json_object', 'json_schema'],
  responseFormatStrategy: 'native',
  supportsImages: true,
  supportsPdfInput: false,
};

export function getAzureModelInfo(modelId: string): ModelInfo {
  return AZURE_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
