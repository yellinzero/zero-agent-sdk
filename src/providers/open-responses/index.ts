/**
 * Open Responses provider for zero-agent-sdk.
 *
 * Implements the Open Responses API protocol (`/v1/responses`),
 * a standard for AI model endpoints. Uses raw `fetch` — no external
 * SDK dependency required.
 */

export type { OpenResponsesProviderConfig } from './client.js';
export {
  createOpenResponses,
  OpenResponsesProvider,
  openResponses,
} from './client.js';
export { OPEN_RESPONSES_DEFAULT_MODEL_INFO } from './models.js';
