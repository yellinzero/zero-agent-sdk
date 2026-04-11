import type {
  ModelWarning,
  ResponseMeta,
  TranscriptionModel,
  TranscriptionModelCallOptions,
  TranscriptionModelResult,
  TranscriptionSegment,
} from '../multimodal.js';

/** Configuration for the Gladia provider. */
export interface GladiaConfig {
  /** Gladia API key. Defaults to `GLADIA_API_KEY` env var. */
  apiKey?: string;
  /** Base URL for API calls. Defaults to `https://api.gladia.io`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://api.gladia.io';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;

function resolveApiKey(config?: GladiaConfig): string {
  const key = config?.apiKey ?? process.env.GLADIA_API_KEY;
  if (!key) {
    throw new Error(
      'Gladia: API key is required. Set `apiKey` in config or the GLADIA_API_KEY environment variable.'
    );
  }
  return key;
}

function getBaseHeaders(config?: GladiaConfig): Record<string, string> {
  return {
    'x-gladia-key': resolveApiKey(config),
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
        reject(new Error('Gladia: request aborted'));
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
 * Gladia transcription model.
 *
 * Uses a three-step workflow: upload audio, initiate transcription, poll for result.
 * @see https://docs.gladia.io/api-reference/v2/pre-recorded
 */
export class GladiaTranscriptionModel implements TranscriptionModel {
  readonly providerId = 'gladia';

  constructor(
    readonly modelId: string,
    private readonly config?: GladiaConfig
  ) {}

  async doGenerate(options: TranscriptionModelCallOptions): Promise<TranscriptionModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];
    const headers = { ...getBaseHeaders(this.config), ...options.headers };

    // Step 1: Upload audio
    const formData = new FormData();
    const audioData =
      options.audio instanceof Uint8Array ? options.audio : new TextEncoder().encode(options.audio);
    const audioBytes = new Uint8Array(audioData) as Uint8Array<ArrayBuffer>;
    const blob = new Blob([audioBytes], { type: options.mediaType });
    formData.append('audio', blob, `audio.${extensionFromMediaType(options.mediaType)}`);

    const uploadRes = await fetch(`${baseUrl}/v2/upload`, {
      method: 'POST',
      headers,
      body: formData,
      signal: options.signal,
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text().catch(() => '');
      throw new Error(`Gladia: upload failed (${uploadRes.status}): ${errBody}`);
    }

    const uploadData = (await uploadRes.json()) as { audio_url: string };

    // Step 2: Initiate transcription
    const transcriptionBody: Record<string, unknown> = {
      audio_url: uploadData.audio_url,
    };

    // Pass through provider options
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (value !== undefined && value !== null) {
          transcriptionBody[key] = value;
        }
      }
    }

    const initRes = await fetch(`${baseUrl}/v2/pre-recorded`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(transcriptionBody),
      signal: options.signal,
    });

    if (!initRes.ok) {
      const errBody = await initRes.text().catch(() => '');
      throw new Error(`Gladia: transcription init failed (${initRes.status}): ${errBody}`);
    }

    const initData = (await initRes.json()) as { result_url: string };

    // Step 3: Poll for result
    const startTime = Date.now();
    while (true) {
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        throw new Error(`Gladia: transcription timed out after ${POLL_TIMEOUT_MS}ms`);
      }

      await delay(POLL_INTERVAL_MS, options.signal);

      const pollRes = await fetch(initData.result_url, {
        method: 'GET',
        headers,
        signal: options.signal,
      });

      if (!pollRes.ok) {
        const errBody = await pollRes.text().catch(() => '');
        throw new Error(`Gladia: poll failed (${pollRes.status}): ${errBody}`);
      }

      const pollData = (await pollRes.json()) as {
        status: string;
        result?: {
          metadata: { audio_duration: number };
          transcription: {
            full_transcript: string;
            languages: string[];
            utterances: Array<{ start: number; end: number; text: string }>;
          };
        };
      };

      if (pollData.status === 'done') {
        if (!pollData.result) {
          throw new Error('Gladia: transcription result is empty');
        }

        const segments: TranscriptionSegment[] = pollData.result.transcription.utterances.map(
          (u) => ({
            text: u.text,
            startSecond: u.start,
            endSecond: u.end,
          })
        );

        const response: ResponseMeta = {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: Object.fromEntries(pollRes.headers.entries()),
        };

        return {
          text: pollData.result.transcription.full_transcript,
          segments,
          language: pollData.result.transcription.languages[0],
          durationInSeconds: pollData.result.metadata.audio_duration,
          warnings,
          response,
          providerMetadata: { gladia: pollData },
        };
      }

      if (pollData.status === 'error') {
        throw new Error('Gladia: transcription failed');
      }

      // Continue polling for 'queued' / 'processing'
    }
  }
}

/**
 * Create a Gladia provider instance.
 *
 * @example
 * ```ts
 * const gladia = createGladia({ apiKey: 'your-key' });
 * const model = gladia.transcription('default');
 * ```
 */
export function createGladia(config?: GladiaConfig) {
  return {
    /** Create a transcription model. */
    transcription: (modelId?: string) => new GladiaTranscriptionModel(modelId ?? 'default', config),
  };
}
