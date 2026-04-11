/**
 * Black Forest Labs (FLUX) image generation provider.
 *
 * Async flow: POST to generate endpoint -> poll result URL -> download image.
 *
 * @see https://docs.bfl.ai
 */

import type {
  ImageModel,
  ImageModelCallOptions,
  ImageModelResult,
  ModelWarning,
} from '../multimodal.js';
import type { BlackForestLabsImageModelId } from './models.js';
import { BFL_IMAGE_MODELS } from './models.js';

const DEFAULT_BASE_URL = 'https://api.bfl.ai/v1';
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;

/** Configuration for the Black Forest Labs provider. */
export interface BlackForestLabsConfig {
  /** BFL API key. Falls back to `BFL_API_KEY` env var. */
  apiKey?: string;
  /** Override base URL. Default: `https://api.bfl.ai/v1`. */
  baseUrl?: string;
  /** Additional headers for every request. */
  headers?: Record<string, string>;
  /** Polling interval in ms between status checks. Default: 500. */
  pollIntervalMs?: number;
  /** Overall polling timeout in ms. Default: 60 000. */
  pollTimeoutMs?: number;
}

/**
 * ImageModel implementation for Black Forest Labs FLUX models.
 *
 * The BFL API is asynchronous — a generation request returns a polling URL
 * which must be polled until the status becomes `Ready`.
 */
export class BlackForestLabsImageModel implements ImageModel {
  readonly providerId = 'black-forest-labs';
  readonly modelId: string;
  readonly maxImagesPerCall: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(modelId: BlackForestLabsImageModelId, config?: BlackForestLabsConfig) {
    this.modelId = modelId;
    this.maxImagesPerCall = BFL_IMAGE_MODELS[modelId]?.maxImagesPerCall ?? 1;
    this.apiKey = config?.apiKey ?? loadEnvKey('BFL_API_KEY', 'Black Forest Labs');
    this.baseUrl = trimTrailingSlash(config?.baseUrl ?? DEFAULT_BASE_URL);
    this.extraHeaders = config?.headers ?? {};
    this.pollIntervalMs = config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeoutMs = config?.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  }

  async doGenerate(options: ImageModelCallOptions): Promise<ImageModelResult> {
    const warnings: ModelWarning[] = [];
    const headers = this.buildHeaders(options.headers);

    // Derive aspect_ratio from size if aspectRatio not provided
    let aspectRatio = options.aspectRatio;
    if (!aspectRatio && options.size) {
      aspectRatio = sizeToAspectRatio(options.size);
      warnings.push({
        type: 'unsupported',
        feature: 'size',
        details:
          'Black Forest Labs does not accept explicit pixel size. Derived aspect_ratio from size.',
      });
    }

    // Build files map
    const inputImages: Record<string, string> = {};
    if (options.files) {
      for (let i = 0; i < Math.min(options.files.length, 10); i++) {
        const key = i === 0 ? 'input_image' : `input_image_${i + 1}`;
        inputImages[key] = fileToBase64(options.files[i]);
      }
    }

    let maskValue: string | undefined;
    if (options.mask) {
      maskValue = fileToBase64(options.mask);
    }

    const body: Record<string, unknown> = {
      prompt: options.prompt,
      seed: options.seed,
      aspect_ratio: aspectRatio,
      ...inputImages,
      ...(maskValue != null ? { mask: maskValue } : {}),
      ...options.providerOptions,
    };

    // Step 1: Submit generation job
    const submitRes = await fetchJson<BflSubmitResponse>(
      `${this.baseUrl}/${this.modelId}`,
      { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal },
      'Black Forest Labs'
    );

    // Step 2: Poll for result
    const result = await this.pollForResult(
      submitRes.polling_url,
      submitRes.id,
      headers,
      options.signal
    );

    // Step 3: Download image bytes
    const imageRes = await fetchWithError(
      result.imageUrl,
      {
        method: 'GET',
        headers,
        signal: options.signal,
      },
      'Black Forest Labs'
    );
    const imageBytes = new Uint8Array(await imageRes.arrayBuffer());

    const responseHeaders = extractHeaders(imageRes);

    return {
      images: [{ data: imageBytes, mediaType: 'image/png' }],
      warnings,
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
      },
      providerMetadata: {
        blackForestLabs: {
          requestId: submitRes.id,
          ...(result.seed != null && { seed: result.seed }),
          ...(submitRes.cost != null && { cost: submitRes.cost }),
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
      'x-key': this.apiKey,
      ...this.extraHeaders,
      ...extra,
    };
  }

  private async pollForResult(
    pollUrl: string,
    requestId: string,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ imageUrl: string; seed?: number }> {
    const maxAttempts = Math.ceil(this.pollTimeoutMs / Math.max(1, this.pollIntervalMs));
    const url = new URL(pollUrl);
    if (!url.searchParams.has('id')) {
      url.searchParams.set('id', requestId);
    }

    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetchJson<BflPollResponse>(
        url.toString(),
        { method: 'GET', headers, signal },
        'Black Forest Labs'
      );

      const status = res.status ?? res.state;
      if (status === 'Ready') {
        if (res.result?.sample) {
          return { imageUrl: res.result.sample, seed: res.result.seed };
        }
        throw new Error('[Black Forest Labs] Poll response is Ready but missing result.sample');
      }
      if (status === 'Error' || status === 'Failed') {
        throw new Error('[Black Forest Labs] Image generation failed during polling.');
      }

      await delay(this.pollIntervalMs);
    }

    throw new Error('[Black Forest Labs] Image generation timed out during polling.');
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Black Forest Labs provider instance.
 *
 * @example
 * ```ts
 * const bfl = createBlackForestLabs({ apiKey: 'my-key' });
 * const result = await bfl.image('flux-pro-1.1').doGenerate({ prompt: 'a cat' });
 * ```
 */
export function createBlackForestLabs(config?: BlackForestLabsConfig) {
  return {
    image: (modelId: BlackForestLabsImageModelId) => new BlackForestLabsImageModel(modelId, config),
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface BflSubmitResponse {
  id: string;
  polling_url: string;
  cost?: number;
}

interface BflPollResponse {
  status?: string;
  state?: string;
  result?: {
    sample?: string;
    seed?: number;
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

function fileToBase64(file: { data: Uint8Array | string }): string {
  if (typeof file.data === 'string') return file.data;
  return Buffer.from(file.data).toString('base64');
}

function sizeToAspectRatio(size: string): `${number}:${number}` | undefined {
  const [wStr, hStr] = size.split('x');
  const w = Number(wStr);
  const h = Number(hStr);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
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
