import type {
  ModelWarning,
  ResponseMeta,
  SpeechModel,
  SpeechModelCallOptions,
  SpeechModelResult,
  TranscriptionModel,
  TranscriptionModelCallOptions,
  TranscriptionModelResult,
  TranscriptionSegment,
} from '../multimodal.js';

/** Configuration for the Deepgram provider. */
export interface DeepgramConfig {
  /** Deepgram API key. Defaults to `DEEPGRAM_API_KEY` env var. */
  apiKey?: string;
  /** Base URL for API calls. Defaults to `https://api.deepgram.com`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://api.deepgram.com';

function resolveApiKey(config?: DeepgramConfig): string {
  const key = config?.apiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new Error(
      'Deepgram: API key is required. Set `apiKey` in config or the DEEPGRAM_API_KEY environment variable.'
    );
  }
  return key;
}

function getBaseHeaders(config?: DeepgramConfig): Record<string, string> {
  return {
    Authorization: `Token ${resolveApiKey(config)}`,
    ...config?.headers,
  };
}

/**
 * Deepgram speech synthesis (TTS) model.
 *
 * Voice is embedded in the model ID (e.g., "aura-2-helena-en").
 * @see https://developers.deepgram.com/reference/text-to-speech
 */
export class DeepgramSpeechModel implements SpeechModel {
  readonly providerId = 'deepgram';

  constructor(
    readonly modelId: string,
    private readonly config?: DeepgramConfig
  ) {}

  async doGenerate(options: SpeechModelCallOptions): Promise<SpeechModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];

    const queryParams: Record<string, string> = { model: this.modelId };

    // Map outputFormat
    if (options.outputFormat) {
      const formatMap: Record<string, { encoding: string; container?: string }> = {
        mp3: { encoding: 'mp3' },
        wav: { encoding: 'linear16', container: 'wav' },
        opus: { encoding: 'opus', container: 'ogg' },
        ogg: { encoding: 'opus', container: 'ogg' },
        flac: { encoding: 'flac' },
        aac: { encoding: 'aac' },
        pcm: { encoding: 'linear16', container: 'none' },
      };
      const mapped = formatMap[options.outputFormat.toLowerCase()];
      if (mapped) {
        queryParams.encoding = mapped.encoding;
        if (mapped.container) queryParams.container = mapped.container;
      }
    }

    if (options.voice && options.voice !== this.modelId) {
      warnings.push({
        type: 'unsupported',
        feature: 'voice',
        details: 'Deepgram TTS embeds voice in the model ID. The voice parameter was ignored.',
      });
    }
    if (options.speed != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'speed',
        details: 'Deepgram TTS does not support speed adjustment.',
      });
    }
    if (options.language) {
      warnings.push({
        type: 'unsupported',
        feature: 'language',
        details: 'Deepgram TTS models are language-specific via the model ID.',
      });
    }
    if (options.instructions) {
      warnings.push({
        type: 'unsupported',
        feature: 'instructions',
        details: 'Deepgram TTS does not support instructions.',
      });
    }

    // Pass through provider options to query params
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (value !== undefined && value !== null) {
          queryParams[key] = String(value);
        }
      }
    }

    const queryString = new URLSearchParams(queryParams).toString();
    const url = `${baseUrl}/v1/speak?${queryString}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...getBaseHeaders(this.config),
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify({ text: options.text }),
      signal: options.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Deepgram: speech generation failed (${res.status}): ${errBody}`);
    }

    const audioBuffer = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? 'audio/mpeg';

    const response: ResponseMeta = {
      timestamp: new Date(),
      modelId: this.modelId,
      headers: Object.fromEntries(res.headers.entries()),
    };

    return {
      audio: { data: audioBuffer, mediaType: contentType },
      warnings,
      response,
    };
  }
}

/**
 * Deepgram transcription (STT) model.
 *
 * Sends audio as raw bytes with Content-Type header.
 * @see https://developers.deepgram.com/reference/listen-file
 */
export class DeepgramTranscriptionModel implements TranscriptionModel {
  readonly providerId = 'deepgram';

  constructor(
    readonly modelId: string,
    private readonly config?: DeepgramConfig
  ) {}

  async doGenerate(options: TranscriptionModelCallOptions): Promise<TranscriptionModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];

    const queryParams: Record<string, string> = {
      model: this.modelId,
      diarize: 'true',
    };

    // Pass through provider options
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (value !== undefined && value !== null) {
          queryParams[key] = String(value);
        }
      }
    }

    const queryString = new URLSearchParams(queryParams).toString();
    const url = `${baseUrl}/v1/listen?${queryString}`;

    const audioData =
      options.audio instanceof Uint8Array ? options.audio : new TextEncoder().encode(options.audio);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...getBaseHeaders(this.config),
        'Content-Type': options.mediaType,
        ...options.headers,
      },
      body: audioData,
      signal: options.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Deepgram: transcription failed (${res.status}): ${errBody}`);
    }

    const data = (await res.json()) as {
      metadata?: { duration?: number };
      results?: {
        channels: Array<{
          detected_language?: string;
          alternatives: Array<{
            transcript: string;
            words: Array<{ word: string; start: number; end: number }>;
          }>;
        }>;
      };
    };

    const channel = data.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];
    const segments: TranscriptionSegment[] =
      alt?.words?.map((w) => ({
        text: w.word,
        startSecond: w.start,
        endSecond: w.end,
      })) ?? [];

    const response: ResponseMeta = {
      timestamp: new Date(),
      modelId: this.modelId,
      headers: Object.fromEntries(res.headers.entries()),
    };

    return {
      text: alt?.transcript ?? '',
      segments,
      language: channel?.detected_language,
      durationInSeconds: data.metadata?.duration,
      warnings,
      response,
    };
  }
}

/**
 * Create a Deepgram provider instance.
 *
 * @example
 * ```ts
 * const deepgram = createDeepgram({ apiKey: 'your-key' });
 * const tts = deepgram.speech('aura-2-helena-en');
 * const stt = deepgram.transcription('nova-3');
 * ```
 */
export function createDeepgram(config?: DeepgramConfig) {
  return {
    /** Create a speech synthesis model. */
    speech: (modelId: string) => new DeepgramSpeechModel(modelId, config),
    /** Create a transcription model. */
    transcription: (modelId: string) => new DeepgramTranscriptionModel(modelId, config),
  };
}
