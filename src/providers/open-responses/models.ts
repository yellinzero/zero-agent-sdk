/**
 * Default model info for Open Responses providers.
 *
 * Since models are defined by the backend server, we only provide
 * sensible defaults for unknown models.
 */

import type { ModelInfo } from '../types.js';

/** Default model info used when the server does not advertise capabilities. */
export const OPEN_RESPONSES_DEFAULT_MODEL_INFO: ModelInfo = {
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  supportsThinking: true,
  supportsToolUse: true,
  supportsImages: false,
  supportsPdfInput: false,
};
