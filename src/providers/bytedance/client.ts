import type {
  ModelWarning,
  ResponseMeta,
  VideoModel,
  VideoModelCallOptions,
  VideoModelResult,
} from '../multimodal.js';

/** Configuration for the ByteDance provider. */
export interface ByteDanceConfig {
  /** ByteDance Ark API key. Defaults to `ARK_API_KEY` env var. */
  apiKey?: string;
  /** Base URL for API calls. Defaults to `https://ark.ap-southeast.bytepluses.com/api/v3`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300_000;

/**
 * Resolves the API key from config or environment.
 */
function resolveApiKey(config?: ByteDanceConfig): string {
  const key = config?.apiKey ?? process.env.ARK_API_KEY;
  if (!key) {
    throw new Error(
      'ByteDance: API key is required. Set `apiKey` in config or the ARK_API_KEY environment variable.'
    );
  }
  return key;
}

/**
 * Maps pixel resolution strings to ByteDance resolution tiers.
 */
const RESOLUTION_MAP: Record<string, string> = {
  '1280x720': '720p',
  '720x1280': '720p',
  '1920x1080': '1080p',
  '1080x1920': '1080p',
  '864x496': '480p',
  '496x864': '480p',
  '640x640': '480p',
  '960x960': '720p',
  '1440x1440': '1080p',
};

/**
 * Pauses execution for the given number of milliseconds.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('ByteDance: request aborted'));
      },
      { once: true }
    );
  });
}

/**
 * ByteDance video generation model implementation.
 *
 * Uses the ByteDance Ark API with async task creation and polling.
 * @see https://ark.ap-southeast.bytepluses.com
 */
export class ByteDanceVideoModel implements VideoModel {
  readonly providerId = 'bytedance';
  readonly maxVideosPerCall = 1;

  constructor(
    readonly modelId: string,
    private readonly config?: ByteDanceConfig
  ) {}

  async doGenerate(options: VideoModelCallOptions): Promise<VideoModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const apiKey = resolveApiKey(this.config);
    const warnings: ModelWarning[] = [];

    // Warn about unsupported standard options
    if (options.fps) {
      warnings.push({
        type: 'unsupported',
        feature: 'fps',
        details: 'ByteDance video models do not support custom FPS. Frame rate is fixed at 24 fps.',
      });
    }
    if (options.n != null && options.n > 1) {
      warnings.push({
        type: 'unsupported',
        feature: 'n',
        details: 'ByteDance video models generate 1 video per call.',
      });
    }

    // Build content array
    const content: Array<Record<string, unknown>> = [];
    if (options.prompt) {
      content.push({ type: 'text', text: options.prompt });
    }
    if (options.image) {
      const imageData =
        typeof options.image.data === 'string'
          ? options.image.data
          : Buffer.from(options.image.data).toString('base64');
      content.push({
        type: 'image_url',
        image_url: { url: `data:${options.image.mediaType};base64,${imageData}` },
      });
    }

    // Build request body
    const body: Record<string, unknown> = {
      model: this.modelId,
      content,
    };
    if (options.aspectRatio) body.ratio = options.aspectRatio;
    if (options.duration) body.duration = options.duration;
    if (options.seed) body.seed = options.seed;
    if (options.resolution) {
      body.resolution = RESOLUTION_MAP[options.resolution] ?? options.resolution;
    }

    // Pass through provider options
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (!['pollIntervalMs', 'pollTimeoutMs'].includes(key)) {
          body[key] = value;
        }
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...this.config?.headers,
      ...options.headers,
    };

    // Step 1: Create the task
    const createRes = await fetch(`${baseUrl}/contents/generations/tasks`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!createRes.ok) {
      const errBody = await createRes.text().catch(() => '');
      throw new Error(`ByteDance: task creation failed (${createRes.status}): ${errBody}`);
    }

    const createData = (await createRes.json()) as { id?: string };
    const taskId = createData.id;
    if (!taskId) {
      throw new Error('ByteDance: no task ID returned from API');
    }

    // Step 2: Poll for completion
    const pollInterval =
      (options.providerOptions?.pollIntervalMs as number | undefined) ?? POLL_INTERVAL_MS;
    const pollTimeout =
      (options.providerOptions?.pollTimeoutMs as number | undefined) ?? POLL_TIMEOUT_MS;
    const startTime = Date.now();
    let responseHeaders: Record<string, string> | undefined;

    while (true) {
      if (Date.now() - startTime > pollTimeout) {
        throw new Error(`ByteDance: video generation timed out after ${pollTimeout}ms`);
      }

      await delay(pollInterval, options.signal);

      const statusRes = await fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
        method: 'GET',
        headers: requestHeaders,
        signal: options.signal,
      });

      if (!statusRes.ok) {
        const errBody = await statusRes.text().catch(() => '');
        throw new Error(`ByteDance: status check failed (${statusRes.status}): ${errBody}`);
      }

      responseHeaders = Object.fromEntries(statusRes.headers.entries());
      const statusData = (await statusRes.json()) as {
        status: string;
        content?: { video_url?: string };
        usage?: { completion_tokens?: number };
      };

      if (statusData.status === 'succeeded') {
        const videoUrl = statusData.content?.video_url;
        if (!videoUrl) {
          throw new Error('ByteDance: no video URL in completed response');
        }

        const response: ResponseMeta = {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: responseHeaders,
        };

        return {
          videos: [{ type: 'url', url: videoUrl, mediaType: 'video/mp4' }],
          warnings,
          response,
          providerMetadata: {
            bytedance: { taskId, usage: statusData.usage },
          },
        };
      }

      if (statusData.status === 'failed') {
        throw new Error(`ByteDance: video generation failed: ${JSON.stringify(statusData)}`);
      }

      // Continue polling for 'processing' / 'queued' statuses
    }
  }
}

/**
 * Create a ByteDance provider instance.
 *
 * @example
 * ```ts
 * const bytedance = createByteDance({ apiKey: 'your-key' });
 * const model = bytedance.video('seedance-1-5-pro-251215');
 * const result = await model.doGenerate({ prompt: 'A cat playing piano' });
 * ```
 */
export function createByteDance(config?: ByteDanceConfig) {
  return {
    /** Create a video generation model. */
    video: (modelId: string) => new ByteDanceVideoModel(modelId, config),
  };
}
