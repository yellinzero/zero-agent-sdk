/**
 * Moonshot AI model catalog.
 */

import type { ModelInfo } from '../types.js';

export const MOONSHOTAI_MODELS: Record<string, ModelInfo> = {
  'moonshot-v1-128k': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.84,
    outputTokenCostPer1M: 0.84,
  },
  'moonshot-v1-32k': {
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.34,
    outputTokenCostPer1M: 0.34,
  },
  'moonshot-v1-8k': {
    contextWindow: 8_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.17,
    outputTokenCostPer1M: 0.17,
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

export function getMoonshotAIModelInfo(modelId: string): ModelInfo {
  return MOONSHOTAI_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
