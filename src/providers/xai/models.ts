/**
 * xAI (Grok) model catalog.
 */

import type { ModelInfo } from '../types.js';

export const XAI_MODELS: Record<string, ModelInfo> = {
  'grok-3': {
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 3,
    outputTokenCostPer1M: 15,
  },
  'grok-3-mini': {
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.3,
    outputTokenCostPer1M: 0.5,
  },
  'grok-2': {
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 2,
    outputTokenCostPer1M: 10,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 131_072,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: true,
  supportsResponseFormat: ['text', 'json_object'],
  supportsImages: true,
  supportsPdfInput: false,
};

export function getXAIModelInfo(modelId: string): ModelInfo {
  return XAI_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
