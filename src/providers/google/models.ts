/**
 * Google Gemini model catalog with metadata.
 */

import type { ModelInfo } from '../types.js';

export const GOOGLE_MODELS: Record<string, ModelInfo> = {
  'gemini-2.5-pro': {
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 1.25,
    outputTokenCostPer1M: 10,
  },
  'gemini-2.5-flash': {
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 0.15,
    outputTokenCostPer1M: 0.6,
  },
  'gemini-2.0-flash': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 0.1,
    outputTokenCostPer1M: 0.4,
  },
  'gemini-1.5-pro': {
    contextWindow: 2_097_152,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 1.25,
    outputTokenCostPer1M: 5,
  },
  'gemini-1.5-flash': {
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 0.075,
    outputTokenCostPer1M: 0.3,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 1_048_576,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: true,
  supportsPdfInput: false,
};

export function getGoogleModelInfo(modelId: string): ModelInfo {
  return GOOGLE_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
