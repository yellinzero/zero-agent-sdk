/**
 * Groq model catalog.
 */

import type { ModelInfo } from '../types.js';

export const GROQ_MODELS: Record<string, ModelInfo> = {
  'llama-3.3-70b-versatile': {
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.59,
    outputTokenCostPer1M: 0.79,
  },
  'llama-3.1-8b-instant': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.05,
    outputTokenCostPer1M: 0.08,
  },
  'mixtral-8x7b-32768': {
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.24,
    outputTokenCostPer1M: 0.24,
  },
  'gemma2-9b-it': {
    contextWindow: 8_192,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.2,
    outputTokenCostPer1M: 0.2,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: false,
  supportsPdfInput: false,
};

export function getGroqModelInfo(modelId: string): ModelInfo {
  return GROQ_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
