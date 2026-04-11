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

/** Configuration for the ElevenLabs provider. */
export interface ElevenLabsConfig {
  /** ElevenLabs API key. Defaults to `ELEVENLABS_API_KEY` env var. */
  apiKey?: string;
  /** Base URL for API calls. Defaults to `https://api.elevenlabs.io`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';

function resolveApiKey(config?: ElevenLabsConfig): string {
  const key = config?.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      'ElevenLabs: API key is required. Set `apiKey` in config or the ELEVENLABS_API_KEY environment variable.'
    );
  }
  return key;
}

function getBaseHeaders(config?: ElevenLabsConfig): Record<string, string> {
  return {
    'xi-api-key': resolveApiKey(config),
    ...config?.headers,
  };
}

/**
 * ElevenLabs speech synthesis (TTS) model.
 *
 * @see https://elevenlabs.io/docs/api-reference/text-to-speech
 */
export class ElevenLabsSpeechModel implements SpeechModel {
  readonly providerId = 'elevenlabs';

  constructor(
    readonly modelId: string,
    private readonly config?: ElevenLabsConfig
  ) {}

  async doGenerate(options: SpeechModelCallOptions): Promise<SpeechModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];

    const voiceId = options.voice ?? '21m00Tcm4TlvDq8ikWAM'; // Rachel default voice

    // Build request body
    const body: Record<string, unknown> = {
      text: options.text,
      model_id: this.modelId,
    };

    if (options.language) {
      body.language_code = options.language;
    }

    const voiceSettings: Record<string, unknown> = {};
    if (options.speed != null) {
      voiceSettings.speed = options.speed;
    }
    if (Object.keys(voiceSettings).length > 0) {
      body.voice_settings = voiceSettings;
    }

    if (options.instructions) {
      warnings.push({
        type: 'unsupported',
        feature: 'instructions',
        details: 'ElevenLabs speech models do not support instructions.',
      });
    }

    // Map output format to query params
    const queryParams: Record<string, string> = {};
    if (options.outputFormat) {
      const formatMap: Record<string, string> = {
        mp3: 'mp3_44100_128',
        wav: 'pcm_44100',
        pcm: 'pcm_44100',
      };
      queryParams.output_format = formatMap[options.outputFormat] ?? options.outputFormat;
    }

    // Pass through provider options
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        body[key] = value;
      }
    }

    const queryString = new URLSearchParams(queryParams).toString();
    const url = `${baseUrl}/v1/text-to-speech/${voiceId}${queryString ? `?${queryString}` : ''}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...getBaseHeaders(this.config),
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`ElevenLabs: speech generation failed (${res.status}): ${errBody}`);
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
 * ElevenLabs transcription (STT) model.
 *
 * @see https://elevenlabs.io/docs/api-reference/speech-to-text
 */
export class ElevenLabsTranscriptionModel implements TranscriptionModel {
  readonly providerId = 'elevenlabs';

  constructor(
    readonly modelId: string,
    private readonly config?: ElevenLabsConfig
  ) {}

  async doGenerate(options: TranscriptionModelCallOptions): Promise<TranscriptionModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];

    // Build FormData
    const formData = new FormData();
    formData.append('model_id', this.modelId);

    const audioData =
      options.audio instanceof Uint8Array ? options.audio : new TextEncoder().encode(options.audio);
    const audioBytes = new Uint8Array(audioData) as Uint8Array<ArrayBuffer>;
    const blob = new Blob([audioBytes], { type: options.mediaType });
    formData.append('file', blob, `audio.${extensionFromMediaType(options.mediaType)}`);

    // Pass through provider options as form fields
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      }
    }

    const res = await fetch(`${baseUrl}/v1/speech-to-text`, {
      method: 'POST',
      headers: {
        ...getBaseHeaders(this.config),
        ...options.headers,
      },
      body: formData,
      signal: options.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`ElevenLabs: transcription failed (${res.status}): ${errBody}`);
    }

    const data = (await res.json()) as {
      text: string;
      language_code?: string;
      words?: Array<{
        text: string;
        start?: number;
        end?: number;
      }>;
    };

    const segments: TranscriptionSegment[] =
      data.words?.map((w) => ({
        text: w.text,
        startSecond: w.start ?? 0,
        endSecond: w.end ?? 0,
      })) ?? [];

    const response: ResponseMeta = {
      timestamp: new Date(),
      modelId: this.modelId,
      headers: Object.fromEntries(res.headers.entries()),
    };

    return {
      text: data.text,
      segments,
      language: data.language_code,
      durationInSeconds: data.words?.at(-1)?.end,
      warnings,
      response,
    };
  }
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
 * Create an ElevenLabs provider instance.
 *
 * @example
 * ```ts
 * const elevenlabs = createElevenLabs({ apiKey: 'your-key' });
 * const tts = elevenlabs.speech('eleven_v3');
 * const result = await tts.doGenerate({ text: 'Hello world' });
 * ```
 */
export function createElevenLabs(config?: ElevenLabsConfig) {
  return {
    /** Create a speech synthesis model. */
    speech: (modelId: string) => new ElevenLabsSpeechModel(modelId, config),
    /** Create a transcription model. */
    transcription: (modelId: string) => new ElevenLabsTranscriptionModel(modelId, config),
  };
}
