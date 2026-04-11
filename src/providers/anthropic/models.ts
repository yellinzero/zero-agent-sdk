/**
 * Anthropic model catalog with metadata.
 */

import type { ModelInfo } from '../types.js';

export const ANTHROPIC_MODELS: Record<string, ModelInfo> = {
  'claude-opus-4-20250514': {
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsThinking: true,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 15,
    outputTokenCostPer1M: 75,
  },
  'claude-sonnet-4-20250514': {
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsThinking: true,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 3,
    outputTokenCostPer1M: 15,
  },
  'claude-haiku-4-5-20251001': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 0.8,
    outputTokenCostPer1M: 4,
  },
  // Aliases
  'claude-opus-4-6': {
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsThinking: true,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 15,
    outputTokenCostPer1M: 75,
  },
  'claude-sonnet-4-6': {
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsThinking: true,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 3,
    outputTokenCostPer1M: 15,
  },
};

/** Default model info for unknown models */
const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 200_000,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: true,
  supportsPdfInput: false,
};

export function getAnthropicModelInfo(modelId: string): ModelInfo {
  return ANTHROPIC_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
