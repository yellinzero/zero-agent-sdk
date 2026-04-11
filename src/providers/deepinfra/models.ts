/**
 * DeepInfra model catalog.
 */

import type { ModelInfo } from '../types.js';

export const DEEPINFRA_MODELS: Record<string, ModelInfo> = {
  'meta-llama/Meta-Llama-3.1-405B-Instruct': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 1.79,
    outputTokenCostPer1M: 1.79,
  },
  'meta-llama/Meta-Llama-3.1-70B-Instruct': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.52,
    outputTokenCostPer1M: 0.75,
  },
  'mistralai/Mixtral-8x22B-Instruct-v0.1': {
    contextWindow: 65_536,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.65,
    outputTokenCostPer1M: 0.65,
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

export function getDeepInfraModelInfo(modelId: string): ModelInfo {
  return DEEPINFRA_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
