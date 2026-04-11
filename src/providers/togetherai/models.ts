/**
 * Together AI model catalog.
 */

import type { ModelInfo } from '../types.js';

export const TOGETHERAI_MODELS: Record<string, ModelInfo> = {
  'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 3.5,
    outputTokenCostPer1M: 3.5,
  },
  'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.88,
    outputTokenCostPer1M: 0.88,
  },
  'mistralai/Mixtral-8x22B-Instruct-v0.1': {
    contextWindow: 65_536,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 1.2,
    outputTokenCostPer1M: 1.2,
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

export function getTogetherAIModelInfo(modelId: string): ModelInfo {
  return TOGETHERAI_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
