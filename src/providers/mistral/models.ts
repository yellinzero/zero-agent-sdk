/**
 * Mistral model catalog with metadata.
 */

import type { ModelInfo } from '../types.js';

export const MISTRAL_MODELS: Record<string, ModelInfo> = {
  'mistral-large-latest': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2,
    outputTokenCostPer1M: 6,
  },
  'mistral-medium-latest': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2.7,
    outputTokenCostPer1M: 8.1,
  },
  'mistral-small-latest': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.1,
    outputTokenCostPer1M: 0.3,
  },
  'magistral-medium-latest': {
    contextWindow: 40_000,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2,
    outputTokenCostPer1M: 5,
  },
  'magistral-small-latest': {
    contextWindow: 40_000,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.5,
    outputTokenCostPer1M: 1.5,
  },
  'codestral-latest': {
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.3,
    outputTokenCostPer1M: 0.9,
  },
  'pixtral-large-latest': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2,
    outputTokenCostPer1M: 6,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: false,
  supportsPdfInput: false,
};

export function getMistralModelInfo(modelId: string): ModelInfo {
  return MISTRAL_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
