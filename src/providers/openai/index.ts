/**
 * OpenAI provider for zero-agent-sdk.
 * Implements ModelProvider for OpenAI and compatible APIs.
 */

export type { OpenAIProviderConfig } from './client.js';
export { createOpenAIProvider, OpenAIProvider, openai } from './client.js';
export type { OpenAIEmbeddingConfig } from './embedding.js';
export { createOpenAIEmbedding, OpenAIEmbeddingModel } from './embedding.js';
export { getOpenAIModelInfo, OPENAI_MODELS } from './models.js';
