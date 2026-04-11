/**
 * Baseten model catalog.
 */

import type { ModelInfo } from '../types.js';

export const BASETEN_MODELS: Record<string, ModelInfo> = {};

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: false,
  supportsPdfInput: false,
};

export function getBasetenModelInfo(modelId: string): ModelInfo {
  return BASETEN_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
