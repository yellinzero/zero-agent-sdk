/**
 * Alibaba (Qwen) model catalog with metadata.
 */

import type { ModelInfo } from '../types.js';

export const ALIBABA_MODELS: Record<string, ModelInfo> = {
  'qwen3-max': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 1.6,
    outputTokenCostPer1M: 6.4,
  },
  'qwen-plus': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.8,
    outputTokenCostPer1M: 2,
  },
  'qwen-turbo': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.3,
    outputTokenCostPer1M: 0.6,
  },
  'qwq-plus': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.8,
    outputTokenCostPer1M: 2,
  },
  'qwen-long': {
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.5,
    outputTokenCostPer1M: 2,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: true,
  supportsResponseFormat: ['text', 'json_object'],
  supportsImages: false,
  supportsPdfInput: false,
};

export function getAlibabaModelInfo(modelId: string): ModelInfo {
  return ALIBABA_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
