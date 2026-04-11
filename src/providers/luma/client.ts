/**
 * Luma AI image generation provider.
 *
 * Async flow: POST generation -> poll status -> download image.
 * Luma uses a dream-machine API with queued/dreaming/completed/failed states.
 *
 * @see https://docs.lumalabs.ai/docs/image-generation
 */

import type {
  ImageModel,
  ImageModelCallOptions,
  ImageModelResult,
  ModelWarning,
} from '../multimodal.js';
import type { LumaImageModelId } from './models.js';
import { LUMA_IMAGE_MODELS } from './models.js';

const DEFAULT_BASE_URL = 'https://api.lumalabs.ai';
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;

/** Configuration for the Luma provider. */
export interface LumaConfig {
  /** Luma API key. Falls back to `LUMA_API_KEY` env var. */
  apiKey?: string;
  /** Override base URL. Default: `https://api.lumalabs.ai`. */
  baseUrl?: string;
  /** Additional headers for every request. */
  headers?: Record<string, string>;
  /** Polling interval in ms between status checks. Default: 500. */
  pollIntervalMs?: number;
  /** Maximum number of polling attempts before timeout. Default: 120. */
  maxPollAttempts?: number;
}

/**
 * ImageModel implementation for Luma AI (Photon models).
 *
 * Luma's API is asynchronous — a generation request returns a job ID
 * which must be polled until the state becomes `completed`.
 */
export class LumaImageModel implements ImageModel {
  readonly providerId = 'luma';
  readonly modelId: string;
  readonly maxImagesPerCall: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(modelId: LumaImageModelId, config?: LumaConfig) {
    this.modelId = modelId;
    this.maxImagesPerCall = LUMA_IMAGE_MODELS[modelId]?.maxImagesPerCall ?? 1;
    this.apiKey = config?.apiKey ?? loadEnvKey('LUMA_API_KEY', 'Luma');
    this.baseUrl = trimTrailingSlash(config?.baseUrl ?? DEFAULT_BASE_URL);
    this.extraHeaders = config?.headers ?? {};
    this.pollIntervalMs = config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = config?.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  }

  async doGenerate(options: ImageModelCallOptions): Promise<ImageModelResult> {
    const warnings: ModelWarning[] = [];
    const headers = this.buildHeaders(options.headers);

    if (options.seed != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'seed',
        details: 'Luma does not support the seed option.',
      });
    }

    if (options.size != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'size',
        details: 'Luma does not support explicit size. Use aspectRatio instead.',
      });
    }

    if (options.mask != null) {
      throw new Error(
        '[Luma] Mask-based image editing is not supported. Use the prompt to describe changes.'
      );
    }

    // Build image references from files (Luma only accepts URLs)
    const imageRefs: Record<string, unknown> = {};
    if (options.files && options.files.length > 0) {
      // Default to image reference type with weight 0.85
      const images = options.files.map((file) => {
        if (typeof file.data !== 'string') {
          throw new Error(
            '[Luma] Only URL-based image references are supported. Provide image URLs as string data.'
          );
        }
        return { url: file.data, weight: 0.85 };
      });
      imageRefs.image = images;
    }

    const body: Record<string, unknown> = {
      prompt: options.prompt,
      model: this.modelId,
      ...(options.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
      ...imageRefs,
      ...options.providerOptions,
    };

    // Step 1: Submit generation
    const genUrl = `${this.baseUrl}/dream-machine/v1/generations/image`;
    const genRes = await fetchJson<LumaGenerationResponse>(
      genUrl,
      { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal },
      'Luma'
    );

    // Step 2: Poll for completion
    const imageUrl = await this.pollForImageUrl(genRes.id, headers, options.signal);

    // Step 3: Download image
    const imageRes = await fetchWithError(
      imageUrl,
      { method: 'GET', signal: options.signal },
      'Luma'
    );
    const imageBytes = new Uint8Array(await imageRes.arrayBuffer());
    const mediaType = imageRes.headers.get('content-type') ?? 'image/png';

    return {
      images: [{ data: imageBytes, mediaType }],
      warnings,
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...this.extraHeaders,
      ...extra,
    };
  }

  private async pollForImageUrl(
    generationId: string,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<string> {
    const url = `${this.baseUrl}/dream-machine/v1/generations/${generationId}`;

    for (let i = 0; i < this.maxPollAttempts; i++) {
      const res = await fetchJson<LumaGenerationResponse>(
        url,
        { method: 'GET', headers, signal },
        'Luma'
      );

      if (res.state === 'completed') {
        if (res.assets?.image) {
          return res.assets.image;
        }
        throw new Error('[Luma] Generation completed but no image asset was found.');
      }

      if (res.state === 'failed') {
        throw new Error(
          `[Luma] Image generation failed: ${res.failure_reason ?? 'unknown reason'}`
        );
      }

      await delay(this.pollIntervalMs);
    }

    throw new Error(`[Luma] Image generation timed out after ${this.maxPollAttempts} attempts.`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Luma provider instance.
 *
 * @example
 * ```ts
 * const luma = createLuma({ apiKey: 'my-key' });
 * const result = await luma.image('photon-1').doGenerate({ prompt: 'a sunset' });
 * ```
 */
export function createLuma(config?: LumaConfig) {
  return {
    image: (modelId: LumaImageModelId) => new LumaImageModel(modelId, config),
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LumaGenerationResponse {
  id: string;
  state: 'queued' | 'dreaming' | 'completed' | 'failed';
  failure_reason?: string;
  assets?: {
    image?: string;
  };
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function loadEnvKey(envVar: string, providerName: string): string {
  const key = typeof process !== 'undefined' ? process.env[envVar] : undefined;
  if (!key) {
    throw new Error(
      `[${providerName}] API key is missing. Pass it via config.apiKey or set the ${envVar} environment variable.`
    );
  }
  return key;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithError(
  url: string,
  init: RequestInit,
  providerName: string
): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[${providerName}] HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res;
}

async function fetchJson<T>(url: string, init: RequestInit, providerName: string): Promise<T> {
  const res = await fetchWithError(url, init, providerName);
  return (await res.json()) as T;
}
