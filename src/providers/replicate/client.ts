/**
 * Replicate image generation provider.
 *
 * Replicate uses a synchronous prediction endpoint with a `prefer: wait` header.
 * For versioned models (owner/model:version) the version is sent in the body;
 * for unversioned models the endpoint includes the model path.
 *
 * @see https://replicate.com/docs/reference/http
 */

import type {
  ImageModel,
  ImageModelCallOptions,
  ImageModelResult,
  ModelWarning,
} from '../multimodal.js';
import type { ReplicateImageModelId } from './models.js';
import { REPLICATE_IMAGE_MODELS } from './models.js';

const DEFAULT_BASE_URL = 'https://api.replicate.com/v1';

/** Configuration for the Replicate provider. */
export interface ReplicateConfig {
  /** Replicate API token. Falls back to `REPLICATE_API_TOKEN` env var. */
  apiKey?: string;
  /** Override base URL. Default: `https://api.replicate.com/v1`. */
  baseUrl?: string;
  /** Additional headers for every request. */
  headers?: Record<string, string>;
  /**
   * Maximum time in seconds to wait for the prediction in sync mode.
   * Replicate default is 60 seconds.
   */
  maxWaitTimeSeconds?: number;
}

/**
 * ImageModel implementation for Replicate.
 *
 * Replicate processes predictions synchronously when the `prefer: wait` header
 * is set. The response contains output URLs which are then downloaded.
 */
export class ReplicateImageModel implements ImageModel {
  readonly providerId = 'replicate';
  readonly modelId: string;
  readonly maxImagesPerCall: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxWaitTimeSeconds?: number;

  constructor(modelId: ReplicateImageModelId, config?: ReplicateConfig) {
    this.modelId = modelId;
    const baseModelId = modelId.split(':')[0];
    this.maxImagesPerCall = REPLICATE_IMAGE_MODELS[baseModelId]?.maxImagesPerCall ?? 1;
    this.apiKey = config?.apiKey ?? loadEnvKey('REPLICATE_API_TOKEN', 'Replicate');
    this.baseUrl = trimTrailingSlash(config?.baseUrl ?? DEFAULT_BASE_URL);
    this.extraHeaders = config?.headers ?? {};
    this.maxWaitTimeSeconds = config?.maxWaitTimeSeconds;
  }

  async doGenerate(options: ImageModelCallOptions): Promise<ImageModelResult> {
    const warnings: ModelWarning[] = [];
    const [modelPath, version] = this.modelId.split(':');

    // Handle input images
    const imageInputs: Record<string, string> = {};
    if (options.files && options.files.length > 0) {
      const isFlux2 = /^black-forest-labs\/flux-2-/.test(this.modelId);
      if (isFlux2) {
        for (let i = 0; i < Math.min(options.files.length, 8); i++) {
          const key = i === 0 ? 'input_image' : `input_image_${i + 1}`;
          imageInputs[key] = fileToDataUri(options.files[i]);
        }
      } else {
        imageInputs.image = fileToDataUri(options.files[0]);
        if (options.files.length > 1) {
          warnings.push({
            type: 'other',
            details: 'Only the first input image is used for this Replicate model.',
          });
        }
      }
    }

    let maskInput: Record<string, string> = {};
    if (options.mask) {
      maskInput = { mask: fileToDataUri(options.mask) };
    }

    // Build prefer header
    const preferHeader =
      this.maxWaitTimeSeconds != null ? `wait=${this.maxWaitTimeSeconds}` : 'wait';

    const headers = this.buildHeaders(options.headers, { prefer: preferHeader });

    const url =
      version != null
        ? `${this.baseUrl}/predictions`
        : `${this.baseUrl}/models/${modelPath}/predictions`;

    const body = {
      input: {
        prompt: options.prompt,
        aspect_ratio: options.aspectRatio,
        size: options.size,
        seed: options.seed,
        num_outputs: options.n,
        ...imageInputs,
        ...maskInput,
        ...options.providerOptions,
      },
      ...(version != null ? { version } : {}),
    };

    const prediction = await fetchJson<ReplicatePredictionResponse>(
      url,
      { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal },
      'Replicate'
    );

    // Download output images
    const outputUrls = Array.isArray(prediction.output) ? prediction.output : [prediction.output];

    const images = await Promise.all(
      outputUrls.map(async (imageUrl: string) => {
        const res = await fetchWithError(
          imageUrl,
          { method: 'GET', signal: options.signal },
          'Replicate'
        );
        const bytes = new Uint8Array(await res.arrayBuffer());
        const mediaType = res.headers.get('content-type') ?? 'image/png';
        return { data: bytes, mediaType };
      })
    );

    return {
      images,
      warnings,
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: extractHeaders(
          await fetch(url, { method: 'HEAD', headers }).catch(() => new Response())
        ),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildHeaders(
    extra?: Record<string, string>,
    additional?: Record<string, string>
  ): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...this.extraHeaders,
      ...additional,
      ...extra,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Replicate provider instance.
 *
 * @example
 * ```ts
 * const rep = createReplicate({ apiKey: 'r8_...' });
 * const result = await rep.image('black-forest-labs/flux-schnell').doGenerate({ prompt: 'a cat' });
 * ```
 */
export function createReplicate(config?: ReplicateConfig) {
  return {
    image: (modelId: ReplicateImageModelId) => new ReplicateImageModel(modelId, config),
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ReplicatePredictionResponse {
  id: string;
  output: string | string[];
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

function fileToDataUri(file: { data: Uint8Array | string; mediaType: string }): string {
  if (typeof file.data === 'string') {
    return `data:${file.mediaType};base64,${file.data}`;
  }
  const b64 = Buffer.from(file.data).toString('base64');
  return `data:${file.mediaType};base64,${b64}`;
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

function extractHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}
