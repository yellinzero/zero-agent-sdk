/**
 * Perplexity model catalog.
 */

import type { ModelInfo } from '../types.js';

export const PERPLEXITY_MODELS: Record<string, ModelInfo> = {
  'sonar-pro': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: false,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 3,
    outputTokenCostPer1M: 15,
  },
  sonar: {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: false,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 1,
    outputTokenCostPer1M: 1,
  },
  'sonar-reasoning-pro': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    supportsToolUse: false,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2,
    outputTokenCostPer1M: 8,
  },
  'sonar-reasoning': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    supportsToolUse: false,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 1,
    outputTokenCostPer1M: 5,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: false,
  supportsImages: false,
  supportsPdfInput: false,
};

export function getPerplexityModelInfo(modelId: string): ModelInfo {
  return PERPLEXITY_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
