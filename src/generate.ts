/**
 * Top-level convenience functions for multimodal generation.
 *
 * These are thin wrappers around the model interfaces, adding retry logic
 * and a friendlier API surface.  They are standalone — they do NOT require
 * an Agent or an agent loop.
 */

import type {
  EmbeddingModel,
  EmbeddingModelResult,
  FileWithType,
  ImageModel,
  ImageModelResult,
  SpeechModel,
  SpeechModelResult,
  TranscriptionModel,
  TranscriptionModelResult,
  VideoModel,
  VideoModelResult,
} from './providers/multimodal.js';

// ---------------------------------------------------------------------------
// Retry helper (shared)
// ---------------------------------------------------------------------------

async function withRetries<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        // Exponential back-off: 200ms, 400ms, 800ms …
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// generateImage
// ---------------------------------------------------------------------------

export interface GenerateImageOptions {
  model: ImageModel;
  prompt: string;
  n?: number;
  size?: `${number}x${number}`;
  aspectRatio?: `${number}:${number}`;
  seed?: number;
  files?: FileWithType[];
  mask?: FileWithType;
  providerOptions?: Record<string, unknown>;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface GenerateImageResult extends ImageModelResult {
  /** Short-hand for images[0]. */
  image: FileWithType;
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  const { model, maxRetries = 2, ...rest } = options;
  const result = await withRetries(
    () => model.doGenerate({ ...rest, prompt: rest.prompt }),
    maxRetries
  );
  return {
    ...result,
    image: result.images[0]!,
  };
}

// ---------------------------------------------------------------------------
// generateSpeech
// ---------------------------------------------------------------------------

export interface GenerateSpeechOptions {
  model: SpeechModel;
  text: string;
  voice?: string;
  outputFormat?: string;
  instructions?: string;
  speed?: number;
  language?: string;
  providerOptions?: Record<string, unknown>;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type GenerateSpeechResult = SpeechModelResult;

export async function generateSpeech(
  options: GenerateSpeechOptions
): Promise<GenerateSpeechResult> {
  const { model, maxRetries = 2, ...rest } = options;
  return withRetries(() => model.doGenerate(rest), maxRetries);
}

// ---------------------------------------------------------------------------
// transcribe
// ---------------------------------------------------------------------------

export interface TranscribeOptions {
  model: TranscriptionModel;
  audio: Uint8Array | string;
  mediaType: string;
  providerOptions?: Record<string, unknown>;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type TranscribeResult = TranscriptionModelResult;

export async function transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
  const { model, maxRetries = 2, ...rest } = options;
  return withRetries(() => model.doGenerate(rest), maxRetries);
}

// ---------------------------------------------------------------------------
// generateVideo
// ---------------------------------------------------------------------------

export interface GenerateVideoOptions {
  model: VideoModel;
  prompt: string;
  n?: number;
  aspectRatio?: `${number}:${number}`;
  resolution?: `${number}x${number}`;
  duration?: number;
  fps?: number;
  seed?: number;
  image?: FileWithType;
  providerOptions?: Record<string, unknown>;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type GenerateVideoResult = VideoModelResult;

export async function generateVideo(options: GenerateVideoOptions): Promise<GenerateVideoResult> {
  const { model, maxRetries = 2, ...rest } = options;
  return withRetries(() => model.doGenerate(rest), maxRetries);
}

// ---------------------------------------------------------------------------
// embed
// ---------------------------------------------------------------------------

export interface EmbedOptions {
  model: EmbeddingModel;
  /** Single text to embed. */
  value: string;
  providerOptions?: Record<string, unknown>;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface EmbedResult {
  /** The input value. */
  value: string;
  /** The embedding vector. */
  embedding: number[];
  usage?: { tokens: number };
}

export async function embed(options: EmbedOptions): Promise<EmbedResult> {
  const { model, value, maxRetries = 2, ...rest } = options;
  const result = await withRetries(() => model.doEmbed({ values: [value], ...rest }), maxRetries);
  return {
    value,
    embedding: result.embeddings[0]!,
    usage: result.usage,
  };
}

// ---------------------------------------------------------------------------
// embedMany
// ---------------------------------------------------------------------------

export interface EmbedManyOptions {
  model: EmbeddingModel;
  values: string[];
  providerOptions?: Record<string, unknown>;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type EmbedManyResult = EmbeddingModelResult;

export async function embedMany(options: EmbedManyOptions): Promise<EmbedManyResult> {
  const { model, maxRetries = 2, ...rest } = options;
  return withRetries(() => model.doEmbed(rest), maxRetries);
}
