/**
 * Google Vertex AI model catalog.
 * Uses the same models as Google Gemini but via GCP endpoint.
 */

import { GOOGLE_MODELS } from '../google/models.js';
import type { ModelInfo } from '../types.js';

export const VERTEX_MODELS: Record<string, ModelInfo> = { ...GOOGLE_MODELS };

const DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 1_048_576,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsToolUse: true,
  supportsImages: true,
  supportsPdfInput: false,
};

export function getVertexModelInfo(modelId: string): ModelInfo {
  return VERTEX_MODELS[modelId] ?? DEFAULT_MODEL_INFO;
}
