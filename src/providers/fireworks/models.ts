/**
 * Fireworks AI model catalog.
 */

import type { ModelInfo } from '../types.js';

export const FIREWORKS_MODELS: Record<string, ModelInfo> = {
  'accounts/fireworks/models/llama-v3p1-405b-instruct': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 3,
    outputTokenCostPer1M: 3,
  },
  'accounts/fireworks/models/llama-v3p1-70b-instruct': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.9,
    outputTokenCostPer1M: 0.9,
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

export function getFireworksModelInfo(modelId: string): ModelInfo {
  return FIREWORKS_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
