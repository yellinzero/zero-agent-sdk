/**
 * Cohere model catalog.
 */

import type { ModelInfo } from '../types.js';

export const COHERE_MODELS: Record<string, ModelInfo> = {
  'command-r-plus': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2.5,
    outputTokenCostPer1M: 10,
  },
  'command-r': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.15,
    outputTokenCostPer1M: 0.6,
  },
  'command-a': {
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2.5,
    outputTokenCostPer1M: 10,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: false,
  supportsPdfInput: false,
};

export function getCohereModelInfo(modelId: string): ModelInfo {
  return COHERE_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
