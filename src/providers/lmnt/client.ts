import type {
  ModelWarning,
  ResponseMeta,
  SpeechModel,
  SpeechModelCallOptions,
  SpeechModelResult,
} from '../multimodal.js';

/** Configuration for the LMNT provider. */
export interface LMNTConfig {
  /** LMNT API key. Defaults to `LMNT_API_KEY` env var. */
  apiKey?: string;
  /** Base URL for API calls. Defaults to `https://api.lmnt.com`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://api.lmnt.com';

function resolveApiKey(config?: LMNTConfig): string {
  const key = config?.apiKey ?? process.env.LMNT_API_KEY;
  if (!key) {
    throw new Error(
      'LMNT: API key is required. Set `apiKey` in config or the LMNT_API_KEY environment variable.'
    );
  }
  return key;
}

/**
 * LMNT speech synthesis model.
 *
 * @see https://docs.lmnt.com/api-reference/speech/synthesize-speech-bytes
 */
export class LMNTSpeechModel implements SpeechModel {
  readonly providerId = 'lmnt';

  constructor(
    readonly modelId: string,
    private readonly config?: LMNTConfig
  ) {}

  async doGenerate(options: SpeechModelCallOptions): Promise<SpeechModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];

    const body: Record<string, unknown> = {
      model: this.modelId,
      text: options.text,
      voice: options.voice ?? 'ava',
      response_format: 'mp3',
    };

    if (options.speed != null) {
      body.speed = options.speed;
    }

    if (options.outputFormat) {
      const validFormats = ['mp3', 'aac', 'mulaw', 'raw', 'wav'];
      if (validFormats.includes(options.outputFormat)) {
        body.response_format = options.outputFormat;
      } else {
        warnings.push({
          type: 'unsupported',
          feature: 'outputFormat',
          details: `Unsupported output format: ${options.outputFormat}. Using mp3 instead.`,
        });
      }
    }

    if (options.language) {
      body.language = options.language;
    }

    if (options.instructions) {
      warnings.push({
        type: 'unsupported',
        feature: 'instructions',
        details: 'LMNT speech models do not support instructions.',
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

    const res = await fetch(`${baseUrl}/v1/ai/speech/bytes`, {
      method: 'POST',
      headers: {
        'x-api-key': resolveApiKey(this.config),
        'Content-Type': 'application/json',
        ...this.config?.headers,
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`LMNT: speech generation failed (${res.status}): ${errBody}`);
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
 * Create an LMNT provider instance.
 *
 * @example
 * ```ts
 * const lmnt = createLMNT({ apiKey: 'your-key' });
 * const model = lmnt.speech('aurora');
 * const result = await model.doGenerate({ text: 'Hello world' });
 * ```
 */
export function createLMNT(config?: LMNTConfig) {
  return {
    /** Create a speech synthesis model. */
    speech: (modelId: string) => new LMNTSpeechModel(modelId, config),
  };
}
