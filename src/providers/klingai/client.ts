import type {
  ModelWarning,
  ResponseMeta,
  VideoModel,
  VideoModelCallOptions,
  VideoModelResult,
} from '../multimodal.js';

/** Configuration for the KlingAI provider. */
export interface KlingAIConfig {
  /** KlingAI access key. Defaults to `KLINGAI_ACCESS_KEY` env var. */
  accessKey?: string;
  /** KlingAI secret key. Defaults to `KLINGAI_SECRET_KEY` env var. */
  secretKey?: string;
  /** Base URL for API calls. Defaults to `https://api-singapore.klingai.com`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://api-singapore.klingai.com';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 600_000;

type KlingAIVideoMode = 't2v' | 'i2v' | 'motion-control';

const MODE_ENDPOINT_MAP: Record<KlingAIVideoMode, string> = {
  t2v: '/v1/videos/text2video',
  i2v: '/v1/videos/image2video',
  'motion-control': '/v1/videos/motion-control',
};

/**
 * Detects the video generation mode from the model ID suffix.
 */
function detectMode(modelId: string): KlingAIVideoMode {
  if (modelId.endsWith('-t2v')) return 't2v';
  if (modelId.endsWith('-i2v')) return 'i2v';
  if (modelId.endsWith('-motion-control')) return 'motion-control';
  throw new Error(
    `KlingAI: cannot detect mode from model ID "${modelId}". Expected suffix: -t2v, -i2v, or -motion-control`
  );
}

/**
 * Derives the KlingAI API `model_name` from the SDK model ID.
 * Strips the mode suffix and converts dots to hyphens.
 */
function getApiModelName(modelId: string, mode: KlingAIVideoMode): string {
  const suffix = mode === 'motion-control' ? '-motion-control' : `-${mode}`;
  const baseName = modelId.slice(0, -suffix.length);
  return baseName.replace(/\.0$/, '').replace(/\./g, '-');
}

/**
 * Encode a string to base64url format (URL-safe base64 without padding).
 */
function base64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a JWT authentication token for KlingAI API access using HS256.
 */
async function generateAuthToken(accessKey: string, secretKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5 };

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const signatureBase64 = base64url(
    String.fromCharCode.apply(null, Array.from(new Uint8Array(signature)))
  );

  return `${signingInput}.${signatureBase64}`;
}

function resolveKeys(config?: KlingAIConfig): { accessKey: string; secretKey: string } {
  const accessKey = config?.accessKey ?? process.env.KLINGAI_ACCESS_KEY;
  const secretKey = config?.secretKey ?? process.env.KLINGAI_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error(
      'KlingAI: accessKey and secretKey are required. Set them in config or via KLINGAI_ACCESS_KEY / KLINGAI_SECRET_KEY env vars.'
    );
  }
  return { accessKey, secretKey };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('KlingAI: request aborted'));
      },
      { once: true }
    );
  });
}

/**
 * KlingAI video generation model implementation.
 *
 * Supports text-to-video, image-to-video, and motion control modes.
 * Uses JWT authentication and async task creation with polling.
 *
 * @see https://app.klingai.com/global/dev/document-api
 */
export class KlingAIVideoModel implements VideoModel {
  readonly providerId = 'klingai';
  readonly maxVideosPerCall = 1;

  constructor(
    readonly modelId: string,
    private readonly config?: KlingAIConfig
  ) {}

  async doGenerate(options: VideoModelCallOptions): Promise<VideoModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const { accessKey, secretKey } = resolveKeys(this.config);
    const token = await generateAuthToken(accessKey, secretKey);
    const warnings: ModelWarning[] = [];
    const mode = detectMode(this.modelId);

    // Warn about universally unsupported standard options
    if (options.resolution) {
      warnings.push({
        type: 'unsupported',
        feature: 'resolution',
        details: 'KlingAI does not support the resolution option.',
      });
    }
    if (options.seed) {
      warnings.push({
        type: 'unsupported',
        feature: 'seed',
        details: 'KlingAI does not support seed for deterministic generation.',
      });
    }
    if (options.fps) {
      warnings.push({
        type: 'unsupported',
        feature: 'fps',
        details: 'KlingAI does not support custom FPS.',
      });
    }
    if (options.n != null && options.n > 1) {
      warnings.push({
        type: 'unsupported',
        feature: 'n',
        details: 'KlingAI generates 1 video per call.',
      });
    }

    const body = this.buildBody(mode, options, warnings);
    const endpointPath = MODE_ENDPOINT_MAP[mode];

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...this.config?.headers,
      ...options.headers,
    };

    // Step 1: Create the task
    const createRes = await fetch(`${baseUrl}${endpointPath}`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!createRes.ok) {
      const errBody = await createRes.text().catch(() => '');
      throw new Error(`KlingAI: task creation failed (${createRes.status}): ${errBody}`);
    }

    const createData = (await createRes.json()) as {
      code: number;
      message: string;
      data?: { task_id?: string };
    };
    const taskId = createData.data?.task_id;
    if (!taskId) {
      throw new Error(`KlingAI: no task_id returned. Response: ${JSON.stringify(createData)}`);
    }

    // Step 2: Poll for completion
    const pollInterval =
      (options.providerOptions?.pollIntervalMs as number | undefined) ?? POLL_INTERVAL_MS;
    const pollTimeout =
      (options.providerOptions?.pollTimeoutMs as number | undefined) ?? POLL_TIMEOUT_MS;
    const startTime = Date.now();

    while (true) {
      await delay(pollInterval, options.signal);

      if (Date.now() - startTime > pollTimeout) {
        throw new Error(`KlingAI: video generation timed out after ${pollTimeout}ms`);
      }

      const statusRes = await fetch(`${baseUrl}${endpointPath}/${taskId}`, {
        method: 'GET',
        headers: requestHeaders,
        signal: options.signal,
      });

      if (!statusRes.ok) {
        const errBody = await statusRes.text().catch(() => '');
        throw new Error(`KlingAI: status check failed (${statusRes.status}): ${errBody}`);
      }

      const statusData = (await statusRes.json()) as {
        code: number;
        data?: {
          task_status: string;
          task_status_msg?: string;
          task_result?: {
            videos?: Array<{
              id?: string;
              url?: string;
              watermark_url?: string;
              duration?: string;
            }>;
          };
        };
      };

      const taskStatus = statusData.data?.task_status;

      if (taskStatus === 'succeed') {
        const videos = statusData.data?.task_result?.videos ?? [];
        const resultVideos = videos
          .filter((v) => v.url)
          .map((v) => ({
            type: 'url' as const,
            url: v.url!,
            mediaType: 'video/mp4',
          }));

        if (resultVideos.length === 0) {
          throw new Error('KlingAI: no valid video URLs in response');
        }

        const response: ResponseMeta = {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: Object.fromEntries(statusRes.headers.entries()),
        };

        return {
          videos: resultVideos,
          warnings,
          response,
          providerMetadata: {
            klingai: {
              taskId,
              videos: videos.map((v) => ({
                id: v.id ?? '',
                url: v.url ?? '',
                ...(v.watermark_url ? { watermarkUrl: v.watermark_url } : {}),
                ...(v.duration ? { duration: v.duration } : {}),
              })),
            },
          },
        };
      }

      if (taskStatus === 'failed') {
        throw new Error(
          `KlingAI: video generation failed: ${statusData.data?.task_status_msg ?? 'Unknown error'}`
        );
      }

      // Continue polling for 'submitted' / 'processing'
    }
  }

  private buildBody(
    mode: KlingAIVideoMode,
    options: VideoModelCallOptions,
    warnings: ModelWarning[]
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model_name: getApiModelName(this.modelId, mode),
    };

    if (options.prompt) body.prompt = options.prompt;

    if (mode === 't2v') {
      if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
      if (options.duration) body.duration = String(options.duration);
      if (options.image) {
        warnings.push({
          type: 'unsupported',
          feature: 'image',
          details: 'KlingAI text-to-video does not support image input. Use an i2v model.',
        });
      }
    } else if (mode === 'i2v') {
      if (options.image) {
        body.image =
          typeof options.image.data === 'string'
            ? options.image.data
            : Buffer.from(options.image.data).toString('base64');
      }
      if (options.duration) body.duration = String(options.duration);
      if (options.aspectRatio) {
        warnings.push({
          type: 'unsupported',
          feature: 'aspectRatio',
          details: 'KlingAI image-to-video does not support aspectRatio.',
        });
      }
    } else {
      // motion-control
      if (options.image) {
        body.image_url =
          typeof options.image.data === 'string'
            ? options.image.data
            : Buffer.from(options.image.data).toString('base64');
      }
      if (options.aspectRatio) {
        warnings.push({
          type: 'unsupported',
          feature: 'aspectRatio',
          details: 'Motion Control does not support aspectRatio.',
        });
      }
      if (options.duration) {
        warnings.push({
          type: 'unsupported',
          feature: 'duration',
          details: 'Motion Control does not support custom duration.',
        });
      }
    }

    // Pass through provider options
    const SKIP_KEYS = new Set(['pollIntervalMs', 'pollTimeoutMs']);
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (!SKIP_KEYS.has(key)) {
          body[key] = value;
        }
      }
    }

    return body;
  }
}

/**
 * Create a KlingAI provider instance.
 *
 * @example
 * ```ts
 * const klingai = createKlingAI({ accessKey: 'ak', secretKey: 'sk' });
 * const model = klingai.video('kling-v2.6-t2v');
 * const result = await model.doGenerate({ prompt: 'A sunset timelapse' });
 * ```
 */
export function createKlingAI(config?: KlingAIConfig) {
  return {
    /** Create a video generation model. */
    video: (modelId: string) => new KlingAIVideoModel(modelId, config),
  };
}
