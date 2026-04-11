/**
 * Portions of this file are adapted from @ai-sdk/provider
 * Copyright 2023 Vercel, Inc.
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Modifications: Removed specificationVersion, simplified ProviderOptions,
 * flattened warning types, adapted to zero-agent-sdk interfaces.
 */

/**
 * Multimodal model interfaces — independent from the language model (ModelProvider).
 *
 * Each interface represents a single capability (image generation, TTS, STT, etc.).
 * Providers implement one or more of these interfaces alongside or instead of
 * the language-model ModelProvider.
 *
 * Design principles:
 *  - Single `doGenerate` / `doEmbed` method per interface (simple contract).
 *  - Provider-specific options go into `providerOptions` (open-ended record).
 *  - Binary data represented as Uint8Array or base64 string.
 *  - All interfaces are pure — no streaming, no agent-loop coupling.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface ModelWarning {
  type: 'unsupported' | 'other';
  feature?: string;
  details?: string;
}

export interface ResponseMeta {
  timestamp: Date;
  modelId: string;
  headers?: Record<string, string>;
}

/** Binary file data. */
export type FileData = Uint8Array | string;

export interface FileWithType {
  data: FileData;
  mediaType: string;
}

// ---------------------------------------------------------------------------
// Image Model
// ---------------------------------------------------------------------------

export interface ImageModel {
  readonly providerId: string;
  readonly modelId: string;
  /** Maximum images the model can produce in a single call. */
  readonly maxImagesPerCall?: number;

  doGenerate(options: ImageModelCallOptions): Promise<ImageModelResult>;
}

export interface ImageModelCallOptions {
  /** Text description of the image to generate. */
  prompt: string;
  /** Number of images to generate (default 1). */
  n?: number;
  /** Explicit pixel size, e.g. "1024x1024". */
  size?: `${number}x${number}`;
  /** Aspect ratio, e.g. "16:9". */
  aspectRatio?: `${number}:${number}`;
  /** Deterministic seed. */
  seed?: number;
  /** Input images for editing / variation workflows. */
  files?: FileWithType[];
  /** Mask image for inpainting. */
  mask?: FileWithType;
  /** Provider-specific options. */
  providerOptions?: Record<string, unknown>;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Additional request headers. */
  headers?: Record<string, string>;
}

export interface ImageModelResult {
  /** Generated images as base64 strings or raw bytes. */
  images: FileWithType[];
  warnings: ModelWarning[];
  response: ResponseMeta;
  /** Provider-specific metadata. */
  providerMetadata?: Record<string, unknown>;
  usage?: { inputTokens?: number; outputTokens?: number };
}

// ---------------------------------------------------------------------------
// Speech Model (TTS)
// ---------------------------------------------------------------------------

export interface SpeechModel {
  readonly providerId: string;
  readonly modelId: string;

  doGenerate(options: SpeechModelCallOptions): Promise<SpeechModelResult>;
}

export interface SpeechModelCallOptions {
  /** Text to synthesize. */
  text: string;
  /** Voice identifier. */
  voice?: string;
  /** Output audio format, e.g. "mp3", "wav". */
  outputFormat?: string;
  /** Instructions for the voice style, e.g. "Speak in a slow and steady tone". */
  instructions?: string;
  /** Speaking speed multiplier (1.0 = normal). */
  speed?: number;
  /** Language ISO 639-1 code, e.g. "en", "zh". */
  language?: string;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface SpeechModelResult {
  /** Generated audio data. */
  audio: FileWithType;
  warnings: ModelWarning[];
  response: ResponseMeta;
  providerMetadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Transcription Model (STT)
// ---------------------------------------------------------------------------

export interface TranscriptionModel {
  readonly providerId: string;
  readonly modelId: string;

  doGenerate(options: TranscriptionModelCallOptions): Promise<TranscriptionModelResult>;
}

export interface TranscriptionModelCallOptions {
  /** Audio data — raw bytes or base64 string. */
  audio: FileData;
  /** IANA media type, e.g. "audio/wav", "audio/mp3". */
  mediaType: string;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface TranscriptionSegment {
  text: string;
  startSecond: number;
  endSecond: number;
}

export interface TranscriptionModelResult {
  /** Full transcript text. */
  text: string;
  /** Time-stamped segments. */
  segments: TranscriptionSegment[];
  /** Detected language (ISO 639-1). */
  language?: string;
  /** Audio duration in seconds. */
  durationInSeconds?: number;
  warnings: ModelWarning[];
  response: ResponseMeta;
  providerMetadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Video Model
// ---------------------------------------------------------------------------

export interface VideoModel {
  readonly providerId: string;
  readonly modelId: string;
  readonly maxVideosPerCall?: number;

  doGenerate(options: VideoModelCallOptions): Promise<VideoModelResult>;
}

export interface VideoModelCallOptions {
  /** Text description of the video to generate. */
  prompt: string;
  /** Number of videos to generate (default 1). */
  n?: number;
  /** Aspect ratio, e.g. "16:9". */
  aspectRatio?: `${number}:${number}`;
  /** Resolution, e.g. "1280x720". */
  resolution?: `${number}x${number}`;
  /** Duration in seconds. */
  duration?: number;
  /** Frames per second. */
  fps?: number;
  /** Deterministic seed. */
  seed?: number;
  /** Input image for image-to-video workflows. */
  image?: FileWithType;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type VideoData =
  | { type: 'url'; url: string; mediaType: string }
  | { type: 'base64'; data: string; mediaType: string }
  | { type: 'binary'; data: Uint8Array; mediaType: string };

export interface VideoModelResult {
  videos: VideoData[];
  warnings: ModelWarning[];
  response: ResponseMeta;
  providerMetadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Embedding Model
// ---------------------------------------------------------------------------

export interface EmbeddingModel {
  readonly providerId: string;
  readonly modelId: string;
  /** Maximum number of texts per call. */
  readonly maxEmbeddingsPerCall?: number;
  /** Whether parallel calls are safe. */
  readonly supportsParallelCalls?: boolean;

  doEmbed(options: EmbeddingModelCallOptions): Promise<EmbeddingModelResult>;
}

export interface EmbeddingModelCallOptions {
  /** Texts to embed. */
  values: string[];
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface EmbeddingModelResult {
  /** Embedding vectors, one per input value. */
  embeddings: number[][];
  usage?: { tokens: number };
  warnings: ModelWarning[];
  response?: ResponseMeta;
  providerMetadata?: Record<string, unknown>;
}
