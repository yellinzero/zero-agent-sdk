import type {
  ModelWarning,
  ResponseMeta,
  SpeechModel,
  SpeechModelCallOptions,
  SpeechModelResult,
} from '../multimodal.js';

/** Configuration for the Hume provider. */
export interface HumeConfig {
  /** Hume API key. Defaults to `HUME_API_KEY` env var. */
  apiKey?: string;
  /** Base URL for API calls. Defaults to `https://api.hume.ai`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://api.hume.ai';

function resolveApiKey(config?: HumeConfig): string {
  const key = config?.apiKey ?? process.env.HUME_API_KEY;
  if (!key) {
    throw new Error(
      'Hume: API key is required. Set `apiKey` in config or the HUME_API_KEY environment variable.'
    );
  }
  return key;
}

/**
 * Hume speech synthesis model.
 *
 * Uses the Hume TTS file endpoint. Voice is specified per-utterance.
 * @see https://dev.hume.ai/reference/text-to-speech-tts/synthesize-file
 */
export class HumeSpeechModel implements SpeechModel {
  readonly providerId = 'hume';

  constructor(
    readonly modelId: string,
    private readonly config?: HumeConfig
  ) {}

  async doGenerate(options: SpeechModelCallOptions): Promise<SpeechModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];

    // Default Hume voice ID
    const voiceId = options.voice ?? 'd8ab67c6-953d-4bd8-9370-8fa53a0f1453';

    const body: Record<string, unknown> = {
      utterances: [
        {
          text: options.text,
          speed: options.speed,
          description: options.instructions,
          voice: {
            id: voiceId,
            provider: 'HUME_AI',
          },
        },
      ],
      format: { type: 'mp3' },
    };

    // Map output format
    if (options.outputFormat) {
      const validFormats = ['mp3', 'pcm', 'wav'];
      if (validFormats.includes(options.outputFormat)) {
        body.format = { type: options.outputFormat };
      } else {
        warnings.push({
          type: 'unsupported',
          feature: 'outputFormat',
          details: `Unsupported output format: ${options.outputFormat}. Using mp3 instead.`,
        });
      }
    }

    if (options.language) {
      warnings.push({
        type: 'unsupported',
        feature: 'language',
        details: 'Hume speech models do not support language selection.',
      });
    }

    // Pass through provider options
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (value !== undefined && value !== null) {
          body[key] = value;
        }
      }
    }

    const res = await fetch(`${baseUrl}/v0/tts/file`, {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': resolveApiKey(this.config),
        'Content-Type': 'application/json',
        ...this.config?.headers,
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Hume: speech generation failed (${res.status}): ${errBody}`);
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
 * Create a Hume provider instance.
 *
 * @example
 * ```ts
 * const hume = createHume({ apiKey: 'your-key' });
 * const model = hume.speech();
 * const result = await model.doGenerate({ text: 'Hello world' });
 * ```
 */
export function createHume(config?: HumeConfig) {
  return {
    /** Create a speech synthesis model. */
    speech: (modelId?: string) => new HumeSpeechModel(modelId ?? '', config),
  };
}
