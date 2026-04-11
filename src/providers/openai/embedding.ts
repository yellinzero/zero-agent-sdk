/**
 * OpenAI Embedding Model implementation.
 * Provides embedding generation via OpenAI's text-embedding API.
 */

import type {
  EmbeddingModel,
  EmbeddingModelCallOptions,
  EmbeddingModelResult,
} from '../multimodal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAIEmbeddingConfig {
  /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Base URL (for compatible providers) */
  baseURL?: string;
  /** Model ID (default: 'text-embedding-3-small') */
  model?: string;
  /** Organization ID */
  organization?: string;
}

// ---------------------------------------------------------------------------
// OpenAI Embedding Model
// ---------------------------------------------------------------------------

export class OpenAIEmbeddingModel implements EmbeddingModel {
  readonly providerId = 'openai';
  readonly modelId: string;
  readonly maxEmbeddingsPerCall = 2048;
  readonly supportsParallelCalls = true;

  private config: OpenAIEmbeddingConfig;

  constructor(config: OpenAIEmbeddingConfig = {}) {
    this.modelId = config.model ?? 'text-embedding-3-small';
    this.config = config;
  }

  async doEmbed(options: EmbeddingModelCallOptions): Promise<EmbeddingModelResult> {
    const openai = await loadOpenAI(this.config);

    const response = await openai.embeddings.create({
      model: this.modelId,
      input: options.values,
      ...(options.providerOptions?.dimensions !== undefined && {
        dimensions: options.providerOptions.dimensions as number,
      }),
    });

    return {
      embeddings: response.data.map((d: any) => d.embedding),
      usage: {
        tokens: response.usage?.prompt_tokens ?? 0,
      },
      warnings: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: lazy-load openai package
// ---------------------------------------------------------------------------

let cachedClient: any = null;
let cachedConfigKey = '';

async function loadOpenAI(config: OpenAIEmbeddingConfig): Promise<any> {
  const configKey = JSON.stringify({
    apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
    baseURL: config.baseURL,
    organization: config.organization,
  });

  if (cachedClient && cachedConfigKey === configKey) return cachedClient;

  try {
    const { default: OpenAI } = await import('openai');
    cachedClient = new OpenAI({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseURL,
      organization: config.organization,
    });
    cachedConfigKey = configKey;
    return cachedClient;
  } catch {
    throw new Error('Failed to import openai package. Install it with: npm install openai');
  }
}

/**
 * Create an OpenAI embedding model.
 */
export function createOpenAIEmbedding(config?: OpenAIEmbeddingConfig): OpenAIEmbeddingModel {
  return new OpenAIEmbeddingModel(config);
}
