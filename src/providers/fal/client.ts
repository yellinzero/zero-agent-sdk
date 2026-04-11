/**
 * FAL image generation provider.
 *
 * FAL provides a synchronous generation endpoint at `https://fal.run/{modelId}`.
 * The response contains image URLs which are then downloaded.
 *
 * @see https://fal.ai/docs
 */

import type {
  ImageModel,
  ImageModelCallOptions,
  ImageModelResult,
  ModelWarning,
} from '../multimodal.js';
import type { FalImageModelId, FalImageSize } from './models.js';
import { FAL_IMAGE_MODELS } from './models.js';

const DEFAULT_BASE_URL = 'https://fal.run';

/** Configuration for the FAL provider. */
export interface FalConfig {
  /** FAL API key. Falls back to `FAL_API_KEY` then `FAL_KEY` env var. */
  apiKey?: string;
  /** Override base URL. Default: `https://fal.run`. */
  baseUrl?: string;
  /** Additional headers for every request. */
  headers?: Record<string, string>;
}

/**
 * ImageModel implementation for fal.ai.
 *
 * FAL endpoints are synchronous — a POST to `/{modelId}` returns
 * the generated images directly in the response.
 */
export class FalImageModel implements ImageModel {
  readonly providerId = 'fal';
  readonly modelId: string;
  readonly maxImagesPerCall: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(modelId: FalImageModelId, config?: FalConfig) {
    this.modelId = modelId;
    this.maxImagesPerCall = FAL_IMAGE_MODELS[modelId]?.maxImagesPerCall ?? 1;
    this.apiKey = config?.apiKey ?? loadFalApiKey('fal.ai');
    this.baseUrl = trimTrailingSlash(config?.baseUrl ?? DEFAULT_BASE_URL);
    this.extraHeaders = config?.headers ?? {};
  }

  async doGenerate(options: ImageModelCallOptions): Promise<ImageModelResult> {
    const warnings: ModelWarning[] = [];
    const headers = this.buildHeaders(options.headers);

    // Convert size / aspectRatio to fal image_size
    let imageSize: FalImageSize | undefined;
    if (options.size) {
      const [w, h] = options.size.split('x').map(Number);
      imageSize = { width: w, height: h };
    } else if (options.aspectRatio) {
      imageSize = convertAspectRatioToSize(options.aspectRatio);
    }

    // Handle image input
    const imageInputs: Record<string, unknown> = {};
    if (options.files && options.files.length > 0) {
      imageInputs.image_url = fileToDataUri(options.files[0]);
      if (options.files.length > 1) {
        warnings.push({
          type: 'other',
          details:
            'Only the first input image is used. Set useMultipleImages in providerOptions for multi-image models.',
        });
      }
    }

    // Handle mask for inpainting
    if (options.mask) {
      imageInputs.mask_url = fileToDataUri(options.mask);
    }

    const body: Record<string, unknown> = {
      prompt: options.prompt,
      seed: options.seed,
      image_size: imageSize,
      num_images: options.n,
      ...imageInputs,
      ...options.providerOptions,
    };

    const url = `${this.baseUrl}/${this.modelId}`;
    const res = await fetchJson<FalImageResponse>(
      url,
      { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal },
      'fal.ai'
    );

    // Normalize response: some models return `image` (singular), others `images` (array)
    const targetImages = res.images ?? (res.image ? [res.image] : []);

    // Download all image URLs
    const images = await Promise.all(
      targetImages.map(async (img) => {
        const dlRes = await fetchWithError(
          img.url,
          { method: 'GET', signal: options.signal },
          'fal.ai'
        );
        const bytes = new Uint8Array(await dlRes.arrayBuffer());
        const mediaType = dlRes.headers.get('content-type') ?? 'image/png';
        return { data: bytes, mediaType };
      })
    );

    return {
      images,
      warnings,
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
      },
      providerMetadata: {
        fal: {
          seed: res.seed,
          timings: res.timings,
          ...(res.has_nsfw_concepts != null && {
            hasNsfwConcepts: res.has_nsfw_concepts,
          }),
        },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Key ${this.apiKey}`,
      ...this.extraHeaders,
      ...extra,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fal.ai provider instance.
 *
 * @example
 * ```ts
 * const fal = createFal({ apiKey: 'my-key' });
 * const result = await fal.image('fal-ai/flux/schnell').doGenerate({ prompt: 'a cat' });
 * ```
 */
export function createFal(config?: FalConfig) {
  return {
    image: (modelId: FalImageModelId) => new FalImageModel(modelId, config),
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface FalImageEntry {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

interface FalImageResponse {
  images?: FalImageEntry[];
  image?: FalImageEntry;
  seed?: number;
  timings?: { inference?: number };
  has_nsfw_concepts?: boolean[];
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function loadFalApiKey(description: string): string {
  if (typeof process === 'undefined') {
    throw new Error(
      `[${description}] API key is missing. Pass it via config.apiKey. Environment variables are not supported in this environment.`
    );
  }
  const key = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      `[${description}] API key is missing. Pass it via config.apiKey or set the FAL_API_KEY or FAL_KEY environment variable.`
    );
  }
  return key;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function fileToDataUri(file: { data: Uint8Array | string; mediaType: string }): string {
  if (typeof file.data === 'string') {
    return `data:${file.mediaType};base64,${file.data}`;
  }
  const b64 = Buffer.from(file.data).toString('base64');
  return `data:${file.mediaType};base64,${b64}`;
}

/**
 * Convert an aspect ratio to a fal.ai image_size value.
 */
function convertAspectRatioToSize(aspectRatio: `${number}:${number}`): FalImageSize | undefined {
  switch (aspectRatio) {
    case '1:1':
      return 'square_hd';
    case '16:9':
      return 'landscape_16_9';
    case '9:16':
      return 'portrait_16_9';
    case '4:3':
      return 'landscape_4_3';
    case '3:4':
      return 'portrait_4_3';
    default:
      return undefined;
  }
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
