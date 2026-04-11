/**
 * Amazon Bedrock model catalog.
 */

import type { ModelInfo } from '../types.js';

export const BEDROCK_MODELS: Record<string, ModelInfo> = {
  'anthropic.claude-3-5-sonnet-20241022-v2:0': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: true,
    inputTokenCostPer1M: 3,
    outputTokenCostPer1M: 15,
  },
  'anthropic.claude-3-5-haiku-20241022-v1:0': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.8,
    outputTokenCostPer1M: 4,
  },
  'meta.llama3-1-405b-instruct-v1:0': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: false,
    supportsPdfInput: false,
    inputTokenCostPer1M: 5.32,
    outputTokenCostPer1M: 16,
  },
  'amazon.nova-pro-v1:0': {
    contextWindow: 300_000,
    maxOutputTokens: 5_000,
    supportsThinking: false,
    supportsToolUse: true,
    supportsImages: true,
    supportsPdfInput: false,
    inputTokenCostPer1M: 0.8,
    outputTokenCostPer1M: 3.2,
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

export function getBedrockModelInfo(modelId: string): ModelInfo {
  return BEDROCK_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
