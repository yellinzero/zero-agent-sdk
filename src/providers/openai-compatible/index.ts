/**
 * OpenAI-compatible base provider.
 * Provides the abstract base class for all OpenAI-compatible LLM providers.
 */

export type { OpenAICompatibleConfig } from './base.js';
export { OpenAICompatibleProvider } from './base.js';
export type { GenericOpenAICompatibleConfig } from './generic.js';
export { createOpenAICompatible, GenericOpenAICompatibleProvider } from './generic.js';
