/**
 * DeepSeek model catalog with metadata.
 */

import type { ModelInfo } from '../types.js';

export const DEEPSEEK_MODELS: Record<string, ModelInfo> = {
  'deepseek-chat': {
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.27,
    outputTokenCostPer1M: 1.1,
  },
  'deepseek-reasoner': {
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.55,
    outputTokenCostPer1M: 2.19,
  },
  'deepseek-coder': {
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.27,
    outputTokenCostPer1M: 1.1,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 64_000,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: true,
  supportsResponseFormat: ['text', 'json_object'],
  supportsImages: false,
  supportsPdfInput: false,
};

export function getDeepSeekModelInfo(modelId: string): ModelInfo {
  return DEEPSEEK_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
