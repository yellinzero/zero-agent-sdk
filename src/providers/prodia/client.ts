/**
 * Prodia image generation provider.
 *
 * Prodia uses a multipart response: a single POST to `/job` returns
 * a multipart body containing a JSON job descriptor and the output image.
 *
 * @see https://docs.prodia.com/reference
 */

import type {
  ImageModel,
  ImageModelCallOptions,
  ImageModelResult,
  ModelWarning,
} from '../multimodal.js';
import type { ProdiaImageModelId } from './models.js';
import { PRODIA_IMAGE_MODELS } from './models.js';

const DEFAULT_BASE_URL = 'https://inference.prodia.com/v2';

/** Configuration for the Prodia provider. */
export interface ProdiaConfig {
  /** Prodia API key. Falls back to `PRODIA_API_KEY` env var. */
  apiKey?: string;
  /** Override base URL. Default: `https://inference.prodia.com/v2`. */
  baseUrl?: string;
  /** Additional headers for every request. */
  headers?: Record<string, string>;
}

/**
 * ImageModel implementation for Prodia.
 *
 * Prodia's v2 API returns the generated image as a multipart response
 * in a single synchronous call. The response contains a JSON "job" part
 * and an image "output" part.
 */
export class ProdiaImageModel implements ImageModel {
  readonly providerId = 'prodia';
  readonly modelId: string;
  readonly maxImagesPerCall: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(modelId: ProdiaImageModelId, config?: ProdiaConfig) {
    this.modelId = modelId;
    this.maxImagesPerCall = PRODIA_IMAGE_MODELS[modelId]?.maxImagesPerCall ?? 1;
    this.apiKey = config?.apiKey ?? loadEnvKey('PRODIA_API_KEY', 'Prodia');
    this.baseUrl = trimTrailingSlash(config?.baseUrl ?? DEFAULT_BASE_URL);
    this.extraHeaders = config?.headers ?? {};
  }

  async doGenerate(options: ImageModelCallOptions): Promise<ImageModelResult> {
    const warnings: ModelWarning[] = [];

    // Parse size
    let width: number | undefined;
    let height: number | undefined;
    if (options.size) {
      const [wStr, hStr] = options.size.split('x');
      width = Number(wStr);
      height = Number(hStr);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        warnings.push({
          type: 'unsupported',
          feature: 'size',
          details: `Invalid size format: ${options.size}. Expected WIDTHxHEIGHT.`,
        });
        width = undefined;
        height = undefined;
      }
    }

    if (options.aspectRatio) {
      warnings.push({
        type: 'unsupported',
        feature: 'aspectRatio',
        details: 'Prodia does not support aspectRatio. Use size with explicit width/height.',
      });
    }

    const jobConfig: Record<string, unknown> = {
      prompt: options.prompt,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
      ...(options.seed != null ? { seed: options.seed } : {}),
      ...options.providerOptions,
    };

    const body = JSON.stringify({
      type: this.modelId,
      config: jobConfig,
    });

    const headers = this.buildHeaders(options.headers);

    const res = await fetchWithError(
      `${this.baseUrl}/job`,
      {
        method: 'POST',
        headers,
        body,
        signal: options.signal,
      },
      'Prodia'
    );

    const contentType = res.headers.get('content-type') ?? '';
    const responseHeaders = extractHeaders(res);

    // Prodia may return multipart or single image
    if (contentType.includes('multipart')) {
      const boundary = extractBoundary(contentType);
      const rawBytes = new Uint8Array(await res.arrayBuffer());
      const parts = parseMultipart(rawBytes, boundary);

      let jobResult: ProdiaJobResult | undefined;
      let imageBytes: Uint8Array | undefined;

      for (const part of parts) {
        const disposition = part.headers['content-disposition'] ?? '';
        const partType = part.headers['content-type'] ?? '';

        if (disposition.includes('name="job"')) {
          const json = new TextDecoder().decode(part.body);
          jobResult = JSON.parse(json) as ProdiaJobResult;
        } else if (disposition.includes('name="output"') || partType.startsWith('image/')) {
          imageBytes = part.body;
        }
      }

      if (!imageBytes) {
        throw new Error('[Prodia] Multipart response missing output image.');
      }

      return {
        images: [{ data: imageBytes, mediaType: 'image/png' }],
        warnings,
        response: {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: responseHeaders,
        },
        providerMetadata: jobResult
          ? {
              prodia: {
                jobId: jobResult.id,
                ...(jobResult.config?.seed != null && { seed: jobResult.config.seed }),
                ...(jobResult.metrics?.elapsed != null && {
                  elapsed: jobResult.metrics.elapsed,
                }),
                ...(jobResult.price?.dollars != null && {
                  dollars: jobResult.price.dollars,
                }),
              },
            }
          : undefined,
      };
    }

    // Fallback: assume the response is a raw image
    const imageBytes = new Uint8Array(await res.arrayBuffer());
    return {
      images: [{ data: imageBytes, mediaType: contentType || 'image/png' }],
      warnings,
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'multipart/form-data; image/png',
      Authorization: `Bearer ${this.apiKey}`,
      ...this.extraHeaders,
      ...extra,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Prodia provider instance.
 *
 * @example
 * ```ts
 * const prodia = createProdia({ apiKey: 'my-key' });
 * const result = await prodia.image('inference.flux.schnell.txt2img.v2').doGenerate({ prompt: 'a cat' });
 * ```
 */
export function createProdia(config?: ProdiaConfig) {
  return {
    image: (modelId: ProdiaImageModelId) => new ProdiaImageModel(modelId, config),
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ProdiaJobResult {
  id: string;
  config?: { seed?: number };
  metrics?: { elapsed?: number; ips?: number };
  price?: { product?: string; dollars?: number };
}

interface MultipartPart {
  headers: Record<string, string>;
  body: Uint8Array;
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

function extractHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function extractBoundary(contentType: string): string {
  const match = contentType.match(/boundary=([^\s;]+)/);
  if (!match) {
    throw new Error(`[Prodia] Multipart response missing boundary in content-type: ${contentType}`);
  }
  return match[1];
}

/**
 * Parse a multipart response body into individual parts.
 */
function parseMultipart(data: Uint8Array, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBytes = new TextEncoder().encode(`--${boundary}`);

  // Find all boundary positions
  const positions: number[] = [];
  for (let i = 0; i <= data.length - boundaryBytes.length; i++) {
    let match = true;
    for (let j = 0; j < boundaryBytes.length; j++) {
      if (data[i + j] !== boundaryBytes[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      positions.push(i);
    }
  }

  for (let i = 0; i < positions.length - 1; i++) {
    let partStart = positions[i] + boundaryBytes.length;
    const partEnd = positions[i + 1];

    // Skip leading CRLF
    if (data[partStart] === 0x0d && data[partStart + 1] === 0x0a) {
      partStart += 2;
    } else if (data[partStart] === 0x0a) {
      partStart += 1;
    }

    // Trim trailing CRLF
    let trimmedEnd = partEnd;
    if (data[trimmedEnd - 2] === 0x0d && data[trimmedEnd - 1] === 0x0a) {
      trimmedEnd -= 2;
    } else if (data[trimmedEnd - 1] === 0x0a) {
      trimmedEnd -= 1;
    }

    const partData = data.slice(partStart, trimmedEnd);

    // Find header/body separator (double newline)
    let headerEnd = -1;
    for (let j = 0; j < partData.length - 3; j++) {
      if (
        partData[j] === 0x0d &&
        partData[j + 1] === 0x0a &&
        partData[j + 2] === 0x0d &&
        partData[j + 3] === 0x0a
      ) {
        headerEnd = j;
        break;
      }
      if (partData[j] === 0x0a && partData[j + 1] === 0x0a) {
        headerEnd = j;
        break;
      }
    }

    if (headerEnd === -1) continue;

    const headerBytes = partData.slice(0, headerEnd);
    const headerStr = new TextDecoder().decode(headerBytes);
    const headers: Record<string, string> = {};
    for (const line of headerStr.split(/\r?\n/)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        headers[key] = value;
      }
    }

    let bodyStart = headerEnd + 2;
    if (partData[headerEnd] === 0x0d) {
      bodyStart = headerEnd + 4;
    }
    const body = partData.slice(bodyStart);

    parts.push({ headers, body });
  }

  return parts;
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
