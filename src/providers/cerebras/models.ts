/**
 * Cerebras model catalog.
 */

import type { ModelInfo } from '../types.js';

export const CEREBRAS_MODELS: Record<string, ModelInfo> = {
  'llama-3.3-70b': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.85,
    outputTokenCostPer1M: 1.2,
  },
  'llama-3.1-8b': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.1,
    outputTokenCostPer1M: 0.1,
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

export function getCerebrasModelInfo(modelId: string): ModelInfo {
  return CEREBRAS_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
