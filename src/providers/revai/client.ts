import type {
  ModelWarning,
  ResponseMeta,
  TranscriptionModel,
  TranscriptionModelCallOptions,
  TranscriptionModelResult,
  TranscriptionSegment,
} from '../multimodal.js';

/** Configuration for the Rev.ai provider. */
export interface RevAIConfig {
  /** Rev.ai API key. Defaults to `REVAI_API_KEY` env var. */
  apiKey?: string;
  /** Base URL for API calls. Defaults to `https://api.rev.ai`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://api.rev.ai';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;

function resolveApiKey(config?: RevAIConfig): string {
  const key = config?.apiKey ?? process.env.REVAI_API_KEY;
  if (!key) {
    throw new Error(
      'Rev.ai: API key is required. Set `apiKey` in config or the REVAI_API_KEY environment variable.'
    );
  }
  return key;
}

function getBaseHeaders(config?: RevAIConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${resolveApiKey(config)}`,
    ...config?.headers,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Rev.ai: request aborted'));
      },
      { once: true }
    );
  });
}

function extensionFromMediaType(mediaType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/mp4': 'm4a',
  };
  return map[mediaType] ?? 'bin';
}

/**
 * Rev.ai transcription model.
 *
 * Uses an async workflow: submit job via FormData, poll for status, fetch transcript.
 * @see https://docs.rev.ai/api/asynchronous
 */
export class RevAITranscriptionModel implements TranscriptionModel {
  readonly providerId = 'revai';

  constructor(
    readonly modelId: string,
    private readonly config?: RevAIConfig
  ) {}

  async doGenerate(options: TranscriptionModelCallOptions): Promise<TranscriptionModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];
    const headers = { ...getBaseHeaders(this.config), ...options.headers };

    // Build FormData
    const formData = new FormData();
    const audioData =
      options.audio instanceof Uint8Array ? options.audio : new TextEncoder().encode(options.audio);
    const audioBytes = new Uint8Array(audioData) as Uint8Array<ArrayBuffer>;
    const blob = new Blob([audioBytes], { type: options.mediaType });
    formData.append('media', blob, `audio.${extensionFromMediaType(options.mediaType)}`);

    const jobConfig: Record<string, unknown> = { transcriber: this.modelId };
    // Pass through provider options
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (value !== undefined && value !== null) {
          jobConfig[key] = value;
        }
      }
    }
    formData.append('config', JSON.stringify(jobConfig));

    // Step 1: Submit job
    const submitRes = await fetch(`${baseUrl}/speechtotext/v1/jobs`, {
      method: 'POST',
      headers,
      body: formData,
      signal: options.signal,
    });

    if (!submitRes.ok) {
      const errBody = await submitRes.text().catch(() => '');
      throw new Error(`Rev.ai: job submission failed (${submitRes.status}): ${errBody}`);
    }

    const submitData = (await submitRes.json()) as {
      id: string;
      status?: string;
      language?: string;
    };

    if (submitData.status === 'failed') {
      throw new Error('Rev.ai: job submission returned failed status');
    }

    const jobId = submitData.id;

    // Step 2: Poll for completion
    const startTime = Date.now();
    while (true) {
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        throw new Error(`Rev.ai: transcription timed out after ${POLL_TIMEOUT_MS}ms`);
      }

      await delay(POLL_INTERVAL_MS, options.signal);

      const pollRes = await fetch(`${baseUrl}/speechtotext/v1/jobs/${jobId}`, {
        method: 'GET',
        headers,
        signal: options.signal,
      });

      if (!pollRes.ok) {
        const errBody = await pollRes.text().catch(() => '');
        throw new Error(`Rev.ai: poll failed (${pollRes.status}): ${errBody}`);
      }

      const pollData = (await pollRes.json()) as { status?: string; language?: string };

      if (pollData.status === 'transcribed') {
        // Step 3: Fetch transcript
        const transcriptRes = await fetch(`${baseUrl}/speechtotext/v1/jobs/${jobId}/transcript`, {
          method: 'GET',
          headers: { ...headers, Accept: 'application/vnd.rev.transcript.v1.0+json' },
          signal: options.signal,
        });

        if (!transcriptRes.ok) {
          const errBody = await transcriptRes.text().catch(() => '');
          throw new Error(`Rev.ai: transcript fetch failed (${transcriptRes.status}): ${errBody}`);
        }

        const transcriptData = (await transcriptRes.json()) as {
          monologues?: Array<{
            elements?: Array<{
              type?: string;
              value?: string;
              ts?: number;
              end_ts?: number;
            }>;
          }>;
        };

        let durationInSeconds = 0;
        const segments: TranscriptionSegment[] = [];
        const textParts: string[] = [];

        for (const monologue of transcriptData.monologues ?? []) {
          const monologueText: string[] = [];
          for (const el of monologue.elements ?? []) {
            monologueText.push(el.value ?? '');
            if (el.type === 'text' && el.ts != null && el.end_ts != null) {
              segments.push({
                text: el.value ?? '',
                startSecond: el.ts,
                endSecond: el.end_ts,
              });
              if (el.end_ts > durationInSeconds) durationInSeconds = el.end_ts;
            }
          }
          textParts.push(monologueText.join(''));
        }

        const response: ResponseMeta = {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: Object.fromEntries(transcriptRes.headers.entries()),
        };

        return {
          text: textParts.join(' '),
          segments,
          language: pollData.language ?? submitData.language,
          durationInSeconds,
          warnings,
          response,
        };
      }

      if (pollData.status === 'failed') {
        throw new Error('Rev.ai: transcription job failed');
      }

      // Continue polling
    }
  }
}

/**
 * Create a Rev.ai provider instance.
 *
 * @example
 * ```ts
 * const revai = createRevAI({ apiKey: 'your-key' });
 * const model = revai.transcription('machine');
 * ```
 */
export function createRevAI(config?: RevAIConfig) {
  return {
    /** Create a transcription model. */
    transcription: (modelId: string) => new RevAITranscriptionModel(modelId, config),
  };
}
