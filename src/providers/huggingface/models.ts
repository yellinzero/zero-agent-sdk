/**
 * Hugging Face model catalog.
 */

import type { ModelInfo } from '../types.js';

export const HUGGINGFACE_MODELS: Record<string, ModelInfo> = {
  'meta-llama/Meta-Llama-3.1-70B-Instruct': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: false,
    supportsPdfInput: false,
  },
  'mistralai/Mistral-7B-Instruct-v0.3': {
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsToolUse: true,
    supportsResponseFormat: ['text', 'json_object'],
    supportsImages: false,
    supportsPdfInput: false,
  },
};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
  supportsThinking: false,
  supportsToolUse: true,
  supportsResponseFormat: ['text', 'json_object'],
  supportsImages: false,
  supportsPdfInput: false,
};

export function getHuggingFaceModelInfo(modelId: string): ModelInfo {
  return HUGGINGFACE_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
